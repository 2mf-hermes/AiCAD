/* ============================================================================
   偏好設定 Sheet
   ----------------------------------------------------------------------------
   四件事在同一個浮層裡完成，靠左側分類導覽切換，而不是拆成多個視窗：
     一般 / AI 模型 / 更新 / 關於

   為什麼分類，而不是一條長表單：原本所有欄位堆在一個滾動區裡，找「語言」要
   滑過整串 provider 欄位。分類之後每一頁都短到不必滾動 —— 這是「專業工具」
   和「設定塞不下就加滾軸」的差別。

   為什麼引擎清單改成下拉而不是保留左欄：左欄現在讓給分類導覽了。引擎切換用
   自製 Select（primitives/Select.tsx），順帶讓使用者第一眼就看到下拉清單也
   套了同一套視覺語彙，沒有原生灰底方框。

   字串全部走 i18n；這個檔案裡不該再出現任何寫死的顯示文字。
   ========================================================================== */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatDateTime, useLocale, useT } from '../i18n';
import { LOCALES, LOCALE_LABEL, type Locale } from '../i18n/locales';
import { hostVersion, isDesktop } from '../core/host';
import { ADAPTERS, createDefaultConfig } from '../core/providers/registry';
import { createProvider } from '../core/providers/provider';
import { apiPathOf, stripApiPath } from '../core/net/transport';
import type { ProviderConfig, ProviderId, ProviderType } from '../core/providers/types';
import { ProviderError } from '../core/providers/types';
import { maskSecret, secrets } from '../core/secrets';
import type { Settings, ThemeMode, UpdateChannel } from '../core/settings';
import { settingsBackend } from '../core/settingsStore';
import {
  canAutoUpdate,
  pollUntilDone,
  updateBackend,
  type UpdateStage,
} from '../core/update';
import { IconCheck, IconClose } from './icons';
import { Button, Dot, Field, Section, Segmented, Select, Toggle, type SelectOption } from './primitives';
import './settings.css';
import './utility-dialog.css';

type ProbeState =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'ok'; message: string }
  | { kind: 'err'; message: string; hint?: string };

export type CategoryId = 'general' | 'models' | 'updates' | 'about';

const SETTINGS_PATH = '%APPDATA%\\AiCad\\settings.json';

interface Props {
  settings: Settings;
  onChange: (next: Settings) => void;
  onClose: () => void;
  /** 開啟時直接落在哪一頁（開機更新提示會指定 updates） */
  initialCategory?: CategoryId;
}

export function SettingsSheet({ settings, onChange, onClose, initialCategory }: Props) {
  const t = useT();
  const locale = useLocale();
const [category, setCategory] = useState<CategoryId>(initialCategory ?? 'general');
  const providerSaveRef = useRef<(() => void) | null>(null);
  const [providerEditing, setProviderEditing] = useState(false);
  const [showSaveProviderDialog, setShowSaveProviderDialog] = useState(false);

  const closeSettings = useCallback(() => {
    if (providerEditing) {
      setShowSaveProviderDialog(true);
      return;
    }
    onClose();
  }, [onClose, providerEditing]);

  const cancelCloseSettings = useCallback(() => {
    setShowSaveProviderDialog(false);
  }, []);

  const saveProviderAndClose = useCallback(() => {
    providerSaveRef.current?.();
    setShowSaveProviderDialog(false);
    onClose();
  }, [onClose]);

  // Esc 關閉：桌面應用的基本鍵盤契約
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeSettings();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeSettings]);

  const categories: { id: CategoryId; name: string; meta: string }[] = [
    { id: 'general', name: t.settings.navGeneral, meta: t.settings.language },
    { id: 'models', name: t.settings.navModels, meta: t.settings.engineList },
    { id: 'updates', name: t.settings.navUpdates, meta: t.update.section },
    { id: 'about', name: t.settings.navAbout, meta: t.about.version },
  ];

  return (
    <div className="scrim" onMouseDown={closeSettings} role="presentation">
      <div
        className="sheetmodal"
        role="dialog"
        aria-modal="true"
        aria-label={t.settings.title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="sheetmodal__head">
          <h2 className="sheetmodal__title">{t.settings.title}</h2>
          <div className="sheetmodal__spacer" />
          <button type="button" className="iconbtn" aria-label={t.common.close} onClick={closeSettings}>
            <IconClose size={16} />
          </button>
        </header>

        <div className="sheetmodal__body">
          <nav className="provlist" aria-label={t.settings.title}>
            {categories.map((c) => (
              <button
                key={c.id}
                type="button"
                className="provlist__item"
                aria-selected={category === c.id}
                onClick={() => setCategory(c.id)}
              >
                <Dot state={category === c.id ? 'ok' : 'idle'} />
                <span className="provlist__text">
                  <span className="provlist__name">{c.name}</span>
                  <span className="provlist__meta">{c.meta}</span>
                </span>
              </button>
            ))}
          </nav>

          <div className="provform">
            {category === 'general' && <GeneralPane settings={settings} onChange={onChange} />}
            {category === 'models' && <ModelsPane settings={settings} onChange={onChange} onEditingChange={setProviderEditing} saveRef={providerSaveRef} />}
            {category === 'updates' && (
              <UpdatesPane settings={settings} onChange={onChange} locale={locale} />
            )}
            {category === 'about' && <AboutPane />}
          </div>
        </div>

        <footer className="sheetmodal__foot">
          <p className="sheetmodal__note">
            {t.settings.footNote}
            <br />
            {settingsBackend().kind === 'native-file'
              ? t.settings.storageNative(SETTINGS_PATH)
              : t.settings.storageFallback}
          </p>
          <Button variant="primary" onClick={closeSettings}>
            {t.common.done}
          </Button>
        </footer>
      </div>

      {showSaveProviderDialog && (
        <div className="utility-dialog-backdrop" role="presentation" onMouseDown={cancelCloseSettings}>
          <section
            className="utility-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="provider-save-dialog-title"
            aria-describedby="provider-save-dialog-message"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="utility-dialog__content">
              <h2 id="provider-save-dialog-title" className="utility-dialog__title">
                {t.common.save}
              </h2>
              <p id="provider-save-dialog-message" className="utility-dialog__message">
                {t.provider.saveBeforeClosing}
              </p>
            </div>
            <div className="utility-dialog__actions">
              <Button variant="secondary" onClick={cancelCloseSettings}>{t.common.cancel}</Button>
              <Button variant="primary" onClick={saveProviderAndClose}>{t.common.save}</Button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   一般
   --------------------------------------------------------------------------- */

function GeneralPane({
  settings,
  onChange,
}: {
  settings: Settings;
  onChange: (n: Settings) => void;
}) {
  const t = useT();

  const localeOptions: SelectOption<Locale>[] = LOCALES.map((l) => ({
    value: l,
    label: LOCALE_LABEL[l],
  }));

  return (
    <>
      <Section title={t.settings.language}>
        <Field label={t.settings.languageLabel} hint={t.settings.languageHint}>
          <Select<Locale>
            value={settings.language}
            options={localeOptions}
            ariaLabel={t.settings.languageLabel}
            onChange={(language) => onChange({ ...settings, language })}
          />
        </Field>
      </Section>

      <hr className="divider" />

      <Section title={t.settings.appearance}>
        <Segmented<ThemeMode>
          ariaLabel={t.settings.appearance}
          value={settings.theme}
          onChange={(theme) => onChange({ ...settings, theme })}
          options={[
            { value: 'dark', label: t.settings.themeDark },
            { value: 'light', label: t.settings.themeLight },
            { value: 'system', label: t.settings.themeSystem },
          ]}
        />
      </Section>

      <hr className="divider" />

      <Section title={t.settings.canvas}>
        <div className="provform__grid">
          <Field label={t.settings.canvasWidth} hint={t.settings.canvasHint}>
            <input
              className="input num"
              type="number"
              min={256}
              max={4096}
              step={64}
              value={settings.canvas.width}
              onChange={(e) =>
                onChange({
                  ...settings,
                  canvas: { ...settings.canvas, width: clampDim(e.target.value, settings.canvas.width) },
                })
              }
            />
          </Field>
          <Field label={t.settings.canvasHeight} hint={t.settings.canvasHint}>
            <input
              className="input num"
              type="number"
              min={256}
              max={4096}
              step={64}
              value={settings.canvas.height}
              onChange={(e) =>
                onChange({
                  ...settings,
                  canvas: {
                    ...settings.canvas,
                    height: clampDim(e.target.value, settings.canvas.height),
                  },
                })
              }
            />
          </Field>
        </div>
      </Section>
    </>
  );
}

const clampDim = (raw: string, fallback: number): number => {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(4096, Math.max(256, Math.round(n)));
};

/* ---------------------------------------------------------------------------
   AI 模型
   --------------------------------------------------------------------------- */

function ModelsPane({
  settings,
  onChange,
  onEditingChange,
  saveRef,
}: {
  settings: Settings;
  onChange: (n: Settings) => void;
  onEditingChange: (editing: boolean) => void;
  saveRef: React.MutableRefObject<(() => void) | null>;
}) {
  const t = useT();
  const [selected, setSelected] = useState<ProviderId>(settings.providers[0]?.id ?? '');
  const [probe, setProbe] = useState<ProbeState>({ kind: 'idle' });
  const [secretDraft, setSecretDraft] = useState('');
  const [storedMask, setStoredMask] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ProviderConfig | null>(null);
  const [openEndpoint, setOpenEndpoint] =
    useState<'textEndpoint' | 'imageEndpoint' | 'inpaintEndpoint' | null>(null);
  /**
   * 使用者在 Base URL 尾端自己帶了路徑（/v1、/api…）時，這裡放要確認的字串。
   * 只在離開欄位時問一次，且同一組字串問過就不再重複問。
   */
  const [baseUrlAsk, setBaseUrlAsk] = useState<{ base: string; path: string } | null>(null);
  const [baseUrlKept, setBaseUrlKept] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  const savedCfg = (settings.providers.find((provider) => provider.id === selected) ?? settings.providers[0])!;
  const cfg = draft ?? savedCfg;
  const adapter = ADAPTERS.find((item) => item.id === cfg.legacyAdapterId)!;

  // 文字／生圖／修圖各自一組參考路徑，避免在生圖欄位看到 chat 端點這種不對題的建議。
  const endpointPresets = useMemo(() => {
    switch (cfg.type) {
      case 'openai': return {
        text: ['/v1/chat/completions'],
        image: ['/v1/images/generations'],
        inpaint: ['/v1/images/edits'],
      };
      case 'anthropic': return {
        text: ['/v1/messages'],
        image: [],
        inpaint: [],
      };
      case 'gemini': return {
        text: ['/v1beta/models/{model}:generateContent'],
        image: ['/v1beta/models/{model}:generateContent'],
        inpaint: ['/v1beta/models/{model}:generateContent'],
      };
      case 'openai-compatible':
      case 'custom': return {
        text: ['/v1/chat/completions'],
        image: ['/v1/images/generations'],
        inpaint: ['/v1/images/edits'],
      };
      case 'local': return {
        text: ['http://127.0.0.1:11434/v1/chat/completions', '/v1/chat/completions'],
        image: [],
        inpaint: [],
      };
      default: return { text: [], image: [], inpaint: [] };
    }
  }, [cfg.type]);

  // 三個端點欄位的資料來源，維持渲染順序：文字 → 生圖 → 修圖。
  const endpointFields = useMemo(() => [
    {
      patchKey: 'textEndpoint' as const,
      label: t.provider.endpointText,
      value: cfg.textEndpoint,
      placeholder: '/v1/chat/completions',
      presets: endpointPresets.text,
    },
    {
      patchKey: 'imageEndpoint' as const,
      label: t.provider.endpointImage,
      value: cfg.imageEndpoint,
      placeholder: '/v1/images/generations',
      presets: endpointPresets.image,
    },
    {
      patchKey: 'inpaintEndpoint' as const,
      label: t.provider.endpointInpaint,
      value: cfg.inpaintEndpoint,
      placeholder: '/v1/images/edits',
      presets: endpointPresets.inpaint,
    },
  ], [cfg.textEndpoint, cfg.imageEndpoint, cfg.inpaintEndpoint, endpointPresets, t.provider]);

  useEffect(() => {
    if (!settings.providers.some((provider) => provider.id === selected)) setSelected(settings.providers[0]?.id ?? '');
  }, [selected, settings.providers]);
  useEffect(() => {
    setEditing(false);
    setDraft(null);
    setModels([]);
    setBaseUrlAsk(null);
    setBaseUrlKept('');
  }, [selected]);
  useEffect(() => {
    if (!editing) setBaseUrlAsk(null);
  }, [editing]);
  // 切換引擎時重置探測結果，並讀出已存憑證的遮罩形式（永不還原明文）
  useEffect(() => {
    setProbe({ kind: 'idle' });
    setSecretDraft('');
    let alive = true;
    void secrets()
      .get(cfg.secretRef)
      .then((v) => {
        if (alive) setStoredMask(maskSecret(v));
      });
    return () => {
      alive = false;
      abortRef.current?.abort();
    };
  }, [selected, cfg.secretRef]);

  const patch = useCallback(
    (delta: Partial<ProviderConfig>) => {
      if (!editing) return;
      setDraft((current) => ({ ...(current ?? savedCfg), ...delta }));
    },
    [editing, savedCfg],
  );

  const beginEdit = useCallback(() => {
    setDraft(structuredClone(savedCfg));
    setEditing(true);
  }, [savedCfg]);

  const saveProvider = useCallback(() => {
    if (!editing || !draft) return;
    const nextProviders = settings.providers.map((provider) => provider.id === selected ? draft : provider);
    const activeTextProvider = settings.activeTextProvider !== 'none' &&
      nextProviders.some((provider) => provider.id === settings.activeTextProvider && provider.enabled && provider.capabilities.text)
      ? settings.activeTextProvider
      : 'none';
    const imageFallback = nextProviders.find((provider) => provider.enabled && provider.capabilities.imageGenerate)?.id ?? settings.activeImageProvider;
    const activeImageProvider = nextProviders.some((provider) => provider.id === settings.activeImageProvider && provider.enabled && provider.capabilities.imageGenerate)
      ? settings.activeImageProvider
      : imageFallback;
    onChange({
      ...settings,
      providers: nextProviders,
      activeTextProvider,
      activeImageProvider,
    });
    setEditing(false);
    setDraft(null);
  }, [draft, editing, onChange, selected, settings]);

  useEffect(() => {
    onEditingChange(editing);
    saveRef.current = saveProvider;
    return () => {
      onEditingChange(false);
      saveRef.current = null;
    };
  }, [editing, onEditingChange, saveProvider, saveRef]);

  const saveSecret = useCallback(async () => {
    await secrets().set(cfg.secretRef, secretDraft);
    setStoredMask(maskSecret(secretDraft));
    setSecretDraft('');
  }, [cfg.secretRef, secretDraft]);

  const addProvider = useCallback(() => {
    const id = `provider-${Date.now().toString(36)}`;
    const next = createDefaultConfig('compatible', id);
    next.type = 'openai-compatible'; next.name = 'OpenAI Compatible'; next.label = next.name;
    next.priority = settings.providers.length + 1;
    onChange({ ...settings, providers: [...settings.providers, next] });
    setSelected(id);
    setDraft(structuredClone(next));
    setEditing(true);
  }, [onChange, settings]);

  const changeProviderType = useCallback((type: ProviderType) => {
    const adapterIds = {
      openai: 'openai', anthropic: 'anthropic', gemini: 'gemini',
      'openai-compatible': 'compatible', custom: 'compatible', local: 'ollama',
    } as const;
    const defaults = createDefaultConfig(adapterIds[type], cfg.id);
    patch({ ...defaults, id: cfg.id, type, name: cfg.name, label: cfg.name,
      enabled: cfg.enabled, priority: cfg.priority, secretRef: cfg.secretRef });
  }, [cfg, patch]);

  const duplicateProvider = useCallback(() => {
    const id = `provider-${Date.now().toString(36)}`;
    const next = { ...structuredClone(cfg), id, name: `${cfg.name} Copy`, label: `${cfg.name} Copy`,
      secretRef: `aicad.secret.${id}`, priority: settings.providers.length + 1 };
    onChange({ ...settings, providers: [...settings.providers, next] });
    setSelected(id);
  }, [cfg, onChange, settings]);

  const removeProvider = useCallback(async () => {
    if (settings.providers.length <= 1) return;
    await secrets().remove(cfg.secretRef);
    const providers = settings.providers.filter((provider) => provider.id !== cfg.id)
      .map((provider, index) => ({ ...provider, priority: index + 1 }));
    const replacement = providers[0].id;
    onChange({ ...settings, providers,
      activeImageProvider: settings.activeImageProvider === cfg.id ? replacement : settings.activeImageProvider,
      activeTextProvider: settings.activeTextProvider === cfg.id ? 'none' : settings.activeTextProvider,
    });
    setSelected(replacement);
  }, [cfg.id, cfg.secretRef, onChange, settings]);

  const moveProvider = useCallback((direction: -1 | 1) => {
    const sorted = [...settings.providers].sort((a, b) => a.priority - b.priority);
    const from = sorted.findIndex((provider) => provider.id === cfg.id);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= sorted.length) return;
    [sorted[from], sorted[to]] = [sorted[to], sorted[from]];
    onChange({ ...settings, providers: sorted.map((provider, index) => ({ ...provider, priority: index + 1 })) });
  }, [cfg.id, onChange, settings]);

  const loadModels = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController(); abortRef.current = ctrl; setProbe({ kind: 'busy' });
    try {
      if (secretDraft) await secrets().set(cfg.secretRef, secretDraft);
      const found = await createProvider(cfg).getModels(ctrl.signal);
      setModels(found); setProbe({ kind: 'ok', message: t.provider.modelsFound(found.length) });
    } catch (e) {
      setProbe({ kind: 'err', message: e instanceof Error ? e.message : String(e) });
    }
  }, [cfg, secretDraft, t.provider]);

  const runProbe = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setProbe({ kind: 'busy' });
    try {
      if (secretDraft) await secrets().set(cfg.secretRef, secretDraft);
      const msg = await createProvider(cfg).testConnection(ctrl.signal);
      setProbe({ kind: 'ok', message: msg });
    } catch (e) {
      if (e instanceof ProviderError) {
        setProbe({ kind: 'err', message: e.message, hint: e.hint });
      } else {
        setProbe({ kind: 'err', message: e instanceof Error ? e.message : String(e) });
      }
    }
  }, [cfg, secretDraft]);

  const engineOptions: SelectOption<ProviderId>[] = settings.providers.map((c) => {
    return {
      value: c.id,
      label: c.name || c.label,
      note: c.type === 'local' ? t.settings.local : t.settings.cloud,
    };
  });

  return (
    <>
      <Section
        title={t.settings.engineList}
        aside={
          <span className="field__hint">
            {cfg.type === 'local' ? t.settings.localNoAuth : t.settings.cloudService}
          </span>
        }
      >
        <div className="provider-actions">
          {editing ? (
            <Button variant="primary" onClick={saveProvider}>{t.common.save}</Button>
          ) : (
            <Button variant="primary" onClick={beginEdit}>{t.common.edit}</Button>
          )}
          <Button variant="secondary" onClick={addProvider}>{t.provider.add}</Button>
          <Button variant="secondary" disabled={editing} onClick={duplicateProvider}>{t.provider.duplicate}</Button>
          <Button variant="secondary" disabled={editing} title={t.provider.moveUp} aria-label={t.provider.moveUp} onClick={() => moveProvider(-1)}>↑</Button>
          <Button variant="secondary" disabled={editing} title={t.provider.moveDown} aria-label={t.provider.moveDown} onClick={() => moveProvider(1)}>↓</Button>
          <Button variant="secondary" disabled={editing || settings.providers.length <= 1} onClick={() => void removeProvider()}>{t.provider.delete}</Button>
        </div>
        <Field label={t.settings.engineSection} hint={t.settings.enableEngineHint}>
          <Select<ProviderId>
            value={selected}
            options={engineOptions}
            ariaLabel={t.settings.engineList}
            onChange={setSelected}
            disabled={editing}
          />
        </Field>

        <div className="provform__grid">
          <Field label={t.provider.type} hint={t.provider.typeHint}>
            <Select<ProviderType>
              value={cfg.type}
              ariaLabel={t.provider.type}
              options={[
                { value: 'openai', label: 'OpenAI' }, { value: 'anthropic', label: 'Anthropic' },
                { value: 'gemini', label: 'Gemini' }, { value: 'openai-compatible', label: t.provider.typeOpenAICompatible },
                { value: 'custom', label: t.provider.typeCustom }, { value: 'local', label: t.provider.typeLocal },
              ]}
              onChange={changeProviderType}
              disabled={!editing}
            />
          </Field>
          <Field label={t.provider.priority} hint={t.provider.priorityHint}>
            <input className="input num" type="number" min={1} max={999} disabled={!editing} value={cfg.priority} onChange={(e) => patch({ priority: Math.max(1, Number(e.target.value) || 1) })} />
          </Field>
        </div>

        <Toggle
          label={t.settings.enableEngine}
          description={t.settings.enableEngineHint}
          checked={cfg.enabled}
          disabled={!editing}
          onChange={(enabled) => patch({ enabled })}
        />

        <div className="provform__grid">
          <Toggle
            label={t.settings.capTextFull}
            description={t.settings.textModelHint}
            checked={cfg.capabilities.text}
            disabled={!editing || !adapter.capabilities.text}
            onChange={(text) => patch({ capabilities: { ...cfg.capabilities, text } })}
          />
          <Toggle
            label={t.settings.capVisionFull}
            description={t.settings.textModelHint}
            checked={cfg.capabilities.vision}
            disabled={!editing || !adapter.capabilities.vision}
            onChange={(vision) => patch({ capabilities: { ...cfg.capabilities, vision } })}
          />
          <Toggle
            label={t.settings.capImageFull}
            description={t.settings.imageModelHint}
            checked={cfg.capabilities.imageGenerate}
            disabled={!editing || !adapter.capabilities.imageGenerate}
            onChange={(imageGenerate) => patch({ capabilities: { ...cfg.capabilities, imageGenerate } })}
          />
          <Toggle
            label={t.settings.capInpaintFull}
            description={t.settings.imageModelHint}
            checked={cfg.capabilities.imageInpaint}
            disabled={!editing || !adapter.capabilities.imageInpaint}
            onChange={(imageInpaint) => patch({ capabilities: { ...cfg.capabilities, imageInpaint } })}
          />
        </div>

        <Toggle
          label={t.provider.fallbackEnabled}
          description={t.provider.fallbackEnabledHint}
          checked={cfg.fallbackEnabled}
          disabled={!editing}
          onChange={(fallbackEnabled) => patch({ fallbackEnabled })}
        />
        <div className="provform__grid">
          <Toggle
            label={t.provider.textFallbackEnabled}
            description={t.provider.textFallbackEnabledHint}
            checked={cfg.fallbackEnabled && cfg.textFallbackEnabled}
            disabled={!editing}
            onChange={(textFallbackEnabled) => patch({ textFallbackEnabled })}
          />
          <Toggle
            label={t.provider.imageFallbackEnabled}
            description={t.provider.imageFallbackEnabledHint}
            checked={cfg.fallbackEnabled && cfg.imageFallbackEnabled}
            disabled={!editing}
            onChange={(imageFallbackEnabled) => patch({ imageFallbackEnabled })}
          />
        </div>

        <div className="caps">
          {(
            [
              [t.settings.capImageFull, cfg.capabilities.imageGenerate],
              [t.settings.capInpaintFull, cfg.capabilities.imageInpaint],
              [t.settings.capTextFull, cfg.capabilities.text],
              [t.settings.capVisionFull, cfg.capabilities.vision],
            ] as const
          ).map(([label, on]) => (
            <span key={label} className="cap" data-on={on}>
              {on && <IconCheck size={11} />}
              {label}
            </span>
          ))}
        </div>
      </Section>

      <hr className="divider" />

      <Section title={t.settings.connection}>
        <div className="provform__grid">
          <div className="provform__full">
            <Field label={t.settings.displayName} hint={t.settings.displayNameHint}>
              <input
                className="input"
                disabled={!editing}
                value={cfg.name}
                placeholder={cfg.type}
                onChange={(e) => patch({ name: e.target.value, label: e.target.value })}
              />
            </Field>
          </div>

          <div className="provform__full">
            <Field
              label={t.settings.baseUrl}
              hint={
                cfg.baseUrl
                  ? t.settings.baseUrlRelay
                  : `${t.settings.baseUrlDefault(adapter.defaults.baseUrl)} · ${t.settings.baseUrlRelay}`
              }
            >
              <input
                className="input"
                spellCheck={false}
                disabled={!editing}
                value={cfg.baseUrl}
                placeholder="https://your-relay.example.com"
                onChange={(e) => patch({ baseUrl: e.target.value.trim() })}
                onBlur={(e) => {
                  const base = e.target.value.trim();
                  const path = base ? apiPathOf(base) : '';
                  // 沒有尾端路徑就不用問；同一組字串確認過也不再問。
                  setBaseUrlAsk(path && path !== '/' && base !== baseUrlKept ? { base, path } : null);
                }}
              />
            </Field>
            {baseUrlAsk && (
              <div className="baseurl__ask" role="alert">
                <span className="baseurl__ask-text">{t.settings.baseUrlPathAsk(baseUrlAsk.path)}</span>
                <div className="baseurl__ask-actions">
                  <Button
                    size="sm"
                    onClick={() => {
                      setBaseUrlKept(baseUrlAsk.base);
                      setBaseUrlAsk(null);
                    }}
                  >
                    {t.settings.baseUrlPathKeep}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      const stripped = stripApiPath(baseUrlAsk.base);
                      patch({ baseUrl: stripped });
                      setBaseUrlKept(stripped);
                      setBaseUrlAsk(null);
                    }}
                  >
                    {t.settings.baseUrlPathDrop}
                  </Button>
                </div>
              </div>
            )}
          </div>

          <div className="provform__full">
            {endpointFields.map((field) => (
              <div
                key={field.patchKey}
                className="endpoint__field"
                onBlur={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpenEndpoint(null);
                }}
              >
                <Field label={field.label} hint={t.provider.endpointHint}>
                  <div className="endpoint__row">
                    <input
                      className="input"
                      spellCheck={false}
                      disabled={!editing}
                      value={field.value}
                      placeholder={field.placeholder}
                      onChange={(e) => patch({ [field.patchKey]: e.target.value.trim() } as Partial<ProviderConfig>)}
                    />
                    <Button
                      variant="secondary"
                      disabled={!editing || !field.presets.length}
                      onClick={() => setOpenEndpoint(openEndpoint === field.patchKey ? null : field.patchKey)}
                      aria-label={t.provider.endpointPreset}
                    >
                      ▾
                    </Button>
                  </div>
                  {openEndpoint === field.patchKey && (
                    <div className="endpoint__presets">
                      {field.presets.map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          className="input"
                          onClick={() => {
                            patch({ [field.patchKey]: preset } as Partial<ProviderConfig>);
                            setOpenEndpoint(null);
                          }}
                        >
                          {preset}
                        </button>
                      ))}
                    </div>
                  )}
                </Field>
              </div>
            ))}
          </div>

          {cfg.type !== 'local' && (
            <div className="provform__full">
              <Field
                label={t.settings.apiKey}
                hint={
                  secrets().kind === 'os-keychain'
                    ? t.settings.apiKeyOsHint
                    : t.settings.apiKeySessionHint
                }
              >
                <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
                  <input
                    className="input"
                    type="password"
                    spellCheck={false}
                    autoComplete="off"
                    disabled={!editing}
                    value={secretDraft}
                    placeholder={storedMask || t.settings.apiKeyPlaceholder}
                    onChange={(e) => setSecretDraft(e.target.value)}
                  />
                  <Button
                    onClick={() => void saveSecret()}
                    disabled={!editing || !secretDraft}
                    variant="secondary"
                  >
                    {t.common.save}
                  </Button>
                </div>
              </Field>
            </div>
          )}

          <Field
            label={t.settings.textModel}
            hint={adapter.capabilities.text ? t.settings.textModelHint : t.settings.notSupported}
          >
            <input
              className="input"
              spellCheck={false}
              disabled={!editing || !cfg.capabilities.text}
              value={cfg.textModel}
              placeholder="model"
              onChange={(e) => patch({ textModel: e.target.value.trim() })}
            />
          </Field>

          <Field label="視圖模型（辨識圖片）" hint="留白時跟隨主文字模型；用於分析使用者上傳的圖片。">
            <input className="input" spellCheck={false} disabled={!editing || !cfg.capabilities.vision} value={cfg.visionModel} placeholder={cfg.textModel || '跟隨主文字模型'} onChange={(e) => patch({ visionModel: e.target.value.trim() })} />
          </Field>

          <Field
            label={t.settings.imageModel}
            hint={
              adapter.capabilities.imageGenerate
                ? t.settings.imageModelHint
                : t.settings.notSupported
            }
          >
            <input
              className="input"
              spellCheck={false}
              disabled={!editing || !cfg.capabilities.imageGenerate}
              value={cfg.imageModel}
              placeholder={t.settings.imageModelPlaceholder}
              onChange={(e) => patch({ imageModel: e.target.value.trim() })}
            />
          </Field>

          <Field label="局部重繪模型" hint="留白時跟隨主生圖模型；只用於局部重繪。">
            <input className="input" spellCheck={false} disabled={!editing || !cfg.capabilities.imageInpaint} value={cfg.inpaintModel} placeholder={cfg.imageModel || '跟隨主生圖模型'} onChange={(e) => patch({ inpaintModel: e.target.value.trim() })} />
          </Field>

          <Field
            label={t.settings.textTimeout}
            hint={cfg.type === 'local' ? t.settings.timeoutTextLocalHint : t.settings.timeoutTextCloudHint}
          >
            <input
              className="input num"
              type="number"
              min={5}
              max={3600}
              disabled={!editing}
              value={cfg.textTimeout}
              onChange={(e) =>
                patch({
                  textTimeout: Math.max(5, Math.min(3600, Number(e.target.value) || 90)),
                  timeout: Math.max(5, Math.min(3600, Number(e.target.value) || 90)),
                  timeoutSec: Math.max(5, Math.min(3600, Number(e.target.value) || 90)),
                })
              }
            />
          </Field>

          <Field
            label={t.settings.imageTimeout}
            hint={cfg.type === 'local' ? t.settings.timeoutImageLocalHint : t.settings.timeoutImageCloudHint}
          >
            <input
              className="input num"
              type="number"
              min={5}
              max={3600}
              disabled={!editing}
              value={cfg.imageTimeout}
              onChange={(e) =>
                patch({
                  imageTimeout: Math.max(5, Math.min(3600, Number(e.target.value) || 90)),
                  timeout: Math.max(5, Math.min(3600, Number(e.target.value) || 90)),
                  timeoutSec: Math.max(5, Math.min(3600, Number(e.target.value) || 90)),
                })
              }
            />
          </Field>

          <Field label={t.provider.retryCount} hint={t.provider.retryHint}>
            <input className="input num" type="number" min={0} max={5} disabled={!editing} value={cfg.retryCount} onChange={(e) => patch({ retryCount: Math.max(0, Math.min(5, Number(e.target.value) || 0)) })} />
          </Field>

          <Field label={t.provider.authentication} hint={t.provider.authHint}>
            <Select<ProviderConfig['authentication']['type']>
              value={cfg.authentication.type} ariaLabel={t.provider.authentication}
              options={[{ value: 'none', label: t.provider.authNone }, { value: 'bearer', label: t.provider.authBearer }, { value: 'api-key', label: t.provider.authApiKey }, { value: 'query', label: t.provider.authQuery }]}
              onChange={(type) => patch({ authentication: { ...cfg.authentication, type } })}
              disabled={!editing}
            />
          </Field>

          <div className="provform__full">
            <Field label={t.provider.headers} hint={t.provider.headersHint}>
              <textarea className="textarea" spellCheck={false} disabled={!editing} value={Object.entries(cfg.headers).map(([key, value]) => `${key}: ${value}`).join('\n')} onChange={(e) => patch({ headers: parseHeaders(e.target.value) })} />
            </Field>
          </div>

          {cfg.type === 'custom' && <>
            <div className="provform__full"><Field label={t.provider.requestFormat} hint={t.provider.requestFormatHint}><textarea className="textarea code" spellCheck={false} disabled={!editing} value={cfg.requestFormat.template} onChange={(e) => patch({ requestFormat: { type: 'custom', template: e.target.value } })} /></Field></div>
            <Field label={t.provider.textPath} hint={t.provider.dotPath}><input className="input" disabled={!editing} value={cfg.responseFormat.textPath} onChange={(e) => patch({ responseFormat: { ...cfg.responseFormat, type: 'custom', textPath: e.target.value } })} /></Field>
            <Field label={t.provider.imagePath} hint={t.provider.dotPath}><input className="input" disabled={!editing} value={cfg.responseFormat.imagePath} onChange={(e) => patch({ responseFormat: { ...cfg.responseFormat, type: 'custom', imagePath: e.target.value } })} /></Field>
          </>}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
          <Button
            variant="secondary"
            onClick={() => void runProbe()}
            disabled={probe.kind === 'busy'}
          >
            {probe.kind === 'busy' ? t.settings.probing : t.settings.probe}
          </Button>
          <Button variant="secondary" onClick={() => void loadModels()} disabled={!editing || probe.kind === 'busy'}>{t.provider.loadModels}</Button>
          <ProbeLine state={probe} />
        </div>
        {models.length > 0 && (
          <div className="provform__grid">
            <Field label={t.settings.textModel} hint={cfg.capabilities.text ? t.settings.textModelHint : t.settings.notSupported}>
              <Select<string>
                value={cfg.textModel}
                ariaLabel={t.settings.textModel}
                options={models.map((model) => ({ value: model, label: model }))}
                searchable
                searchPlaceholder={t.provider.modelsHint}
                onChange={(textModel) => patch({ textModel })}
                disabled={!editing || !cfg.capabilities.text}
              />
            </Field>
            <Field label="視圖模型（辨識圖片）" hint={cfg.capabilities.vision ? '可獨立選擇；留白時跟隨主文字模型。' : t.settings.notSupported}>
              <Select<string>
                value={cfg.visionModel}
                ariaLabel="視圖模型（辨識圖片）"
                options={[{ value: '', label: `跟隨主文字模型${cfg.textModel ? `（${cfg.textModel}）` : ''}` }, ...models.map((model) => ({ value: model, label: model }))]}
                searchable
                searchPlaceholder={t.provider.modelsHint}
                onChange={(visionModel) => patch({ visionModel })}
                disabled={!editing || !cfg.capabilities.vision}
              />
            </Field>
            <Field label={t.settings.imageModel} hint={cfg.capabilities.imageGenerate ? t.settings.imageModelHint : t.settings.notSupported}>
              <Select<string>
                value={cfg.imageModel}
                ariaLabel={t.settings.imageModel}
                options={models.map((model) => ({ value: model, label: model }))}
                searchable
                searchPlaceholder={t.provider.modelsHint}
                onChange={(imageModel) => patch({ imageModel })}
                disabled={!editing || !cfg.capabilities.imageGenerate}
              />
            </Field>
            <Field label="局部重繪模型" hint={cfg.capabilities.imageInpaint ? '可獨立選擇；留白時跟隨主生圖模型。' : t.settings.notSupported}>
              <Select<string>
                value={cfg.inpaintModel}
                ariaLabel="局部重繪模型"
                options={[{ value: '', label: `跟隨主生圖模型${cfg.imageModel ? `（${cfg.imageModel}）` : ''}` }, ...models.map((model) => ({ value: model, label: model }))]}
                searchable
                searchPlaceholder={t.provider.modelsHint}
                onChange={(inpaintModel) => patch({ inpaintModel })}
                disabled={!editing || !cfg.capabilities.imageInpaint}
              />
            </Field>
          </div>
        )}
      </Section>
    </>
  );
}

/* ---------------------------------------------------------------------------
   更新
   --------------------------------------------------------------------------- */

function UpdatesPane({
  settings,
  onChange,
  locale,
}: {
  settings: Settings;
  onChange: (n: Settings) => void;
  locale: Locale;
}) {
  const t = useT();
  const [stage, setStage] = useState<UpdateStage>({ kind: 'idle' });
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const supported = canAutoUpdate();

  const check = useCallback(async () => {
    setStage({ kind: 'checking' });
    try {
      const info = await updateBackend().check(settings.updates.channel);
      onChange({
        ...settings,
        updates: { ...settings.updates, lastCheckedAt: new Date().toISOString() },
      });
      if (!aliveRef.current) return;
      setStage(info ? { kind: 'available', info } : { kind: 'up-to-date' });
      /* 檢查到更新 → 提示框，而不是把 release notes 原文傾印在設定頁裡。
         詳細內容留在 GitHub Release 頁，這裡只給「新增／修改／刪除」。 */
      /* 詳細變更內容留在 GitHub Release 頁；設定頁本身就有「下載／安裝」按鈕，
         不需要再疊一層提示框。 */
    } catch (e) {
      if (!aliveRef.current) return;
      setStage({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }, [onChange, settings]);

  const download = useCallback(async () => {
    if (stage.kind !== 'available') return;
    const info = stage.info;
    setStage({ kind: 'downloading', percent: 0, info });
    try {
      await updateBackend().start(info);
      const final = await pollUntilDone(
        (p) => {
          if (aliveRef.current) setStage({ kind: 'downloading', percent: p.percent, info });
        },
        () => !aliveRef.current,
      );
      if (!aliveRef.current) return;
      if (final.error) {
        setStage({ kind: 'error', message: final.error });
        return;
      }
      setStage({ kind: 'ready', info });
    } catch (e) {
      if (!aliveRef.current) return;
      setStage({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }, [stage]);

  const install = useCallback(async () => {
    setStage({ kind: 'installing' });
    try {
      await updateBackend().install();
    } catch (e) {
      if (!aliveRef.current) return;
      setStage({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  const channelOptions: SelectOption<UpdateChannel>[] = [
    { value: 'stable', label: t.update.channelStable },
    { value: 'none', label: t.update.channelNone },
  ];

  const lastChecked = settings.updates.lastCheckedAt
    ? formatDateTime(locale, settings.updates.lastCheckedAt)
    : t.common.never;

  return (
    <>
      <Section title={t.update.section} aside={<span className="field__hint">{t.update.currentVersion(hostVersion())}</span>}>
        <Toggle
          label={t.update.autoCheck}
          description={t.update.autoCheckHint}
          checked={settings.updates.autoCheck}
          onChange={(autoCheck) =>
            onChange({ ...settings, updates: { ...settings.updates, autoCheck } })
          }
        />

        <Field label={t.update.channel} hint={t.update.lastChecked(lastChecked)}>
          <Select<UpdateChannel>
            value={settings.updates.channel}
            options={channelOptions}
            ariaLabel={t.update.channel}
            onChange={(channel) =>
              onChange({ ...settings, updates: { ...settings.updates, channel } })
            }
          />
        </Field>
      </Section>

      <hr className="divider" />

      <Section title={t.update.releaseNotes}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
          <Button
            variant="secondary"
            onClick={() => void check()}
            disabled={!supported || stage.kind === 'checking' || stage.kind === 'downloading'}
          >
            {stage.kind === 'checking' ? t.update.checking : t.update.check}
          </Button>

          {stage.kind === 'available' && (
            <Button variant="primary" onClick={() => void download()}>
              {t.update.download}
            </Button>
          )}
          {stage.kind === 'ready' && (
            <Button variant="primary" onClick={() => void install()}>
              {t.update.install}
            </Button>
          )}

          <UpdateLine stage={stage} supported={supported} />
        </div>

        {(stage.kind === 'available' ||
          stage.kind === 'downloading' ||
          stage.kind === 'ready') && (
          <>
            {/* 顯示這次是從哪裡取得的。沒有這一行，失敗時使用者只看得到
                「取得位置失敗」，完全不知道程式去哪裡找過、還能去哪裡找。 */}
            {stage.info.source && (
              <p className="sheetmodal__note" style={{ wordBreak: 'break-all' }}>
                {t.update.source(stage.info.source)}
              </p>
            )}
          </>
        )}
      </Section>

    </>
  );
}

function UpdateLine({ stage, supported }: { stage: UpdateStage; supported: boolean }) {
  const t = useT();
  if (!supported) return <span className="probe probe--idle">{t.update.unavailable}</span>;

  switch (stage.kind) {
    case 'idle':
      return <span className="probe probe--idle">{t.settings.probeIdle}</span>;
    case 'checking':
      return (
        <span className="probe probe--idle">
          <Dot state="busy" /> {t.update.checking}
        </span>
      );
    case 'up-to-date':
      return (
        <span className="probe probe--ok">
          <Dot state="ok" /> {t.update.upToDate}
        </span>
      );
    case 'available':
      return (
        <span className="probe probe--idle">
          <Dot state="warn" /> {t.update.found(stage.info.version)}
        </span>
      );
    case 'downloading':
      return (
        <span className="probe probe--idle">
          <Dot state="busy" /> {t.update.progress(stage.percent)}
        </span>
      );
    case 'verifying':
      return (
        <span className="probe probe--idle">
          <Dot state="busy" /> {t.update.verifying}
        </span>
      );
    case 'ready':
      return (
        <span className="probe probe--ok">
          <Dot state="ok" /> {t.update.found(stage.info.version)}
        </span>
      );
    case 'installing':
      return (
        <span className="probe probe--idle">
          <Dot state="busy" /> {t.update.installing}
        </span>
      );
    case 'error':
      return (
        <span className="probe probe--err">
          <Dot state="danger" /> {t.update.failed}
          <span className="probe__hint">— {stage.message}</span>
        </span>
      );
  }
}

/* ---------------------------------------------------------------------------
   關於
   --------------------------------------------------------------------------- */

function AboutPane() {
  const t = useT();
  return (
    <Section title={t.about.section}>
      <p className="sheetmodal__note">{t.about.tagline}</p>
      <div className="provform__grid">
        <Field label={t.about.version} hint="">
          <input className="input" value={hostVersion()} readOnly />
        </Field>
        <Field label={t.about.platform} hint="">
          <input
            className="input"
            value={isDesktop() ? t.about.desktop : t.about.browser}
            readOnly
          />
        </Field>
      </div>
      <p className="sheetmodal__note">{t.about.note}</p>
    </Section>
  );
}

/* ------------------------------------------------------------------------- */

function ProbeLine({ state }: { state: ProbeState }) {
  const t = useT();
  if (state.kind === 'idle') {
    return <span className="probe probe--idle">{t.settings.probeIdle}</span>;
  }
  if (state.kind === 'busy') {
    return (
      <span className="probe probe--idle">
        <Dot state="busy" /> {t.settings.probeConnecting}
      </span>
    );
  }
  if (state.kind === 'ok') {
    return (
      <span className="probe probe--ok">
        <Dot state="ok" /> {state.message}
      </span>
    );
  }
  return (
    <span className="probe probe--err">
      <Dot state="danger" /> {state.message}
      {state.hint && <span className="probe__hint">— {state.hint}</span>}
    </span>
  );
}

function parseHeaders(raw: string): Record<string, string> {
  return Object.fromEntries(raw.split(/\r?\n/).map((line) => {
    const at = line.indexOf(':');
    return at > 0 ? [line.slice(0, at).trim(), line.slice(at + 1).trim()] : ['', ''];
  }).filter(([key]) => key));
}
