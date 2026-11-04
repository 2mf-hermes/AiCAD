import { DEFAULT_LOCALE, isLocale, type Locale } from '../i18n/locales';
import { ADAPTERS, createDefaultConfig } from './providers/registry';
import type { LegacyProviderId, ProviderConfig, ProviderType } from './providers/types';
import { settingsBackend } from './settingsStore';

const SCHEMA_VERSION = 3;
export type ThemeMode = 'dark' | 'light' | 'system';
export type UpdateChannel = 'stable' | 'none';

export interface Settings {
  version: number;
  language: Locale;
  theme: ThemeMode;
  canvas: { width: number; height: number };
  providers: ProviderConfig[];
  /** Preferred instance; fallback continues by priority after this instance. */
  activeImageProvider: string;
  activeTextProvider: string | 'none';
  updates: { autoCheck: boolean; channel: UpdateChannel; lastCheckedAt: string };
}

export function createDefaultSettings(): Settings {
  const providers = ADAPTERS.map((adapter) => createDefaultConfig(adapter.id));
  const openai = providers.find((provider) => provider.id === 'openai');
  if (openai) openai.enabled = false;
  return {
    version: SCHEMA_VERSION,
    language: DEFAULT_LOCALE,
    theme: 'dark',
    canvas: { width: 1536, height: 1024 },
    providers,
    activeImageProvider: 'openai',
    activeTextProvider: 'none',
    updates: { autoCheck: true, channel: 'stable', lastCheckedAt: '' },
  };
}

function detectLocale(): Locale {
  if (typeof navigator === 'undefined') return DEFAULT_LOCALE;
  for (const tag of navigator.languages ?? [navigator.language]) {
    const locale = tag.toLowerCase();
    if (locale.startsWith('zh')) return /hant|tw|hk|mo/.test(locale) ? 'zh-Hant' : 'zh-Hans';
    if (locale.startsWith('ja')) return 'ja';
    if (locale.startsWith('ko')) return 'ko';
    if (locale.startsWith('en')) return 'en';
  }
  return DEFAULT_LOCALE;
}

export async function loadSettings(): Promise<Settings> {
  const base = createDefaultSettings();
  let raw = '';
  try { raw = await settingsBackend().load(); } catch { return { ...base, language: detectLocale() }; }
  if (!raw) return { ...base, language: detectLocale() };
  try { return normalizeSettings(JSON.parse(raw), base); } catch { return { ...base, language: detectLocale() }; }
}

export function normalizeSettings(value: unknown, base = createDefaultSettings()): Settings {
  const parsed = isRecord(value) ? value : {};
  const providers = normalizeProviders(parsed.providers, base.providers);
  const image = str(parsed.activeImageProvider, base.activeImageProvider);
  const text = str(parsed.activeTextProvider, base.activeTextProvider);
  return {
    version: SCHEMA_VERSION,
    language: isLocale(parsed.language) ? parsed.language : detectLocale(),
    theme: isTheme(parsed.theme) ? parsed.theme : base.theme,
    canvas: {
      width: clamp(parsed.canvas, 'width', base.canvas.width),
      height: clamp(parsed.canvas, 'height', base.canvas.height),
    },
    providers,
    activeImageProvider: providers.some((p) => p.id === image && p.enabled && p.capabilities.imageGenerate) ? image : firstEnabledCapable(providers, 'imageGenerate', base.activeImageProvider),
    activeTextProvider: text === 'none' ? 'none' : providers.some((p) => p.id === text && p.enabled && p.capabilities.text) ? text : 'none',
    updates: {
      autoCheck: isRecord(parsed.updates) && typeof parsed.updates.autoCheck === 'boolean' ? parsed.updates.autoCheck : base.updates.autoCheck,
      channel: isRecord(parsed.updates) && (parsed.updates.channel === 'stable' || parsed.updates.channel === 'none') ? parsed.updates.channel : base.updates.channel,
      lastCheckedAt: isRecord(parsed.updates) ? str(parsed.updates.lastCheckedAt, '') : '',
    },
  };
}

export async function saveSettings(settings: Settings): Promise<void> {
  const providers = settings.providers.map((provider) => {
    const safe = { ...provider } as ProviderConfig & { apiKey?: unknown };
    delete safe.apiKey;
    return safe;
  });
  try { await settingsBackend().save(JSON.stringify({ ...settings, providers, version: SCHEMA_VERSION }, null, 2)); } catch { /* UI remains usable */ }
}

function normalizeProviders(value: unknown, defaults: ProviderConfig[]): ProviderConfig[] {
  if (Array.isArray(value)) {
    const seen = new Set<string>();
    const normalized = value.filter(isRecord).map((item, index) => normalizeProvider(item, defaults, index)).filter((item) => {
      if (!item.id || seen.has(item.id)) return false;
      seen.add(item.id); return true;
    });
    return normalized.length ? normalized : defaults;
  }
  // v2: provider configs were keyed by one fixed adapter id.
  if (isRecord(value)) {
    return defaults.map((fallback, index) => {
      const item = value[fallback.id];
      return isRecord(item) ? normalizeProvider({ ...item, id: fallback.id, legacyAdapterId: fallback.id }, defaults, index) : fallback;
    });
  }
  return defaults;
}

function normalizeProvider(item: Record<string, unknown>, defaults: ProviderConfig[], index: number): ProviderConfig {
  const legacy = isLegacy(item.legacyAdapterId) ? item.legacyAdapterId : isLegacy(item.id) ? item.id : undefined;
  const fallback = (legacy && defaults.find((provider) => provider.id === legacy)) ?? defaults[0];
  const type = isProviderType(item.type) ? item.type : fallback.type;
  const id = safeId(str(item.id, `provider-${index + 1}`));
  const timeout = number(item.timeout, number(item.timeoutSec, fallback.timeout, 5, 3600), 5, 3600);
  const capabilities = isRecord(item.capabilities) ? {
    text: bool(item.capabilities.text, fallback.capabilities.text),
    imageGenerate: bool(item.capabilities.imageGenerate, fallback.capabilities.imageGenerate),
    imageInpaint: bool(item.capabilities.imageInpaint, fallback.capabilities.imageInpaint),
    vision: bool(item.capabilities.vision, fallback.capabilities.vision),
  } : { ...fallback.capabilities };
  const name = str(item.name, str(item.label, fallback.name));
  const legacyModel = str(item.model, '');
  const textModel = str(item.textModel, legacyModel || fallback.textModel);
  const imageModel = str(item.imageModel, legacyModel || fallback.imageModel);
  const visionModel = str(item.visionModel, '');
  const inpaintModel = str(item.inpaintModel, '');
  return {
    ...fallback, id, type, name, label: name,
    enabled: bool(item.enabled, fallback.enabled), baseUrl: str(item.baseUrl, fallback.baseUrl),
    endpoint: str(item.endpoint, fallback.endpoint), secretRef: str(item.secretRef, `aicad.secret.${id}`),
    model: legacyModel, textModel, visionModel, imageModel, inpaintModel,
    fallbackEnabled: bool(item.fallbackEnabled, true),
    textFallbackEnabled: bool(item.textFallbackEnabled, true),
    imageFallbackEnabled: bool(item.imageFallbackEnabled, true),
    priority: number(item.priority, index + 1, 1, 999), timeout, timeoutSec: timeout,
    retryCount: number(item.retryCount, fallback.retryCount, 0, 5), headers: stringMap(item.headers),
    requestFormat: isRecord(item.requestFormat) ? {
      type: isRequestType(item.requestFormat.type) ? item.requestFormat.type : fallback.requestFormat.type,
      template: str(item.requestFormat.template, ''),
    } : { ...fallback.requestFormat },
    responseFormat: isRecord(item.responseFormat) ? {
      type: isRequestType(item.responseFormat.type) ? item.responseFormat.type : fallback.responseFormat.type,
      textPath: str(item.responseFormat.textPath, ''), imagePath: str(item.responseFormat.imagePath, ''),
      modelsPath: str(item.responseFormat.modelsPath, ''),
    } : { ...fallback.responseFormat },
    authentication: isRecord(item.authentication) ? {
      type: ['none', 'bearer', 'api-key', 'query'].includes(String(item.authentication.type)) ? item.authentication.type as ProviderConfig['authentication']['type'] : fallback.authentication.type,
      headerName: str(item.authentication.headerName, fallback.authentication.headerName),
      queryName: str(item.authentication.queryName, fallback.authentication.queryName),
      prefix: str(item.authentication.prefix, fallback.authentication.prefix),
    } : { ...fallback.authentication },
    capabilities, legacyAdapterId: legacy ?? fallback.legacyAdapterId,
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const str = (value: unknown, fallback: string): string => typeof value === 'string' ? value : fallback;
const bool = (value: unknown, fallback: boolean): boolean => typeof value === 'boolean' ? value : fallback;
const number = (value: unknown, fallback: number, min: number, max: number): number => Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value as number))) : fallback;
const clamp = (value: unknown, key: string, fallback: number): number => isRecord(value) ? number(value[key], fallback, 256, 4096) : fallback;
const stringMap = (value: unknown): Record<string, string> => isRecord(value) ? Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string')) : {};
const safeId = (value: string): string => value.trim().replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 80);
const isTheme = (value: unknown): value is ThemeMode => value === 'dark' || value === 'light' || value === 'system';
const isProviderType = (value: unknown): value is ProviderType => ['openai', 'anthropic', 'gemini', 'openai-compatible', 'custom', 'local'].includes(String(value));
const isRequestType = (value: unknown): value is ProviderConfig['requestFormat']['type'] => ['openai', 'anthropic', 'gemini', 'sd-webui', 'custom'].includes(String(value));
const isLegacy = (value: unknown): value is LegacyProviderId => ADAPTERS.some((adapter) => adapter.id === value);
const firstCapable = (items: ProviderConfig[], key: keyof ProviderConfig['capabilities'], fallback: string) => items.find((item) => item.capabilities[key])?.id ?? fallback;
const firstEnabledCapable = (items: ProviderConfig[], key: keyof ProviderConfig['capabilities'], fallback: string) => items.find((item) => item.enabled && item.capabilities[key])?.id ?? firstCapable(items, key, fallback);
