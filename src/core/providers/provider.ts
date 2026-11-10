import { apiUrl, fetchImageAsBase64, getJson, postJson, trimSlash } from '../net/transport';
import { systemInstructionFor } from '../prompt/builder';
import { secrets } from '../secrets';
import { getAdapter } from './registry';
import {
  AIProvider,
  ProviderError,
  type LegacyProviderId,
  type ProviderConfig,
  type ProviderRequest,
  type ProviderResult,
} from './types';

type JsonRecord = Record<string, unknown>;

/** Provider instance backed by one persisted config and one encrypted secret. */
class AdapterProvider extends AIProvider {
  async generate(request: ProviderRequest, signal: AbortSignal): Promise<ProviderResult> {
    const adapter = getAdapter(this.config.legacyAdapterId ?? adapterId(this.config));
    const secret = await secrets().get(this.config.secretRef);
    try {
      if (request.mode === 'text' && adapter.refinePrompt) {
        if (request.input.images?.length && !this.config.capabilities.vision) throw new ProviderError('此 Provider 未啟用視圖能力', this.config.id);
        return await adapter.refinePrompt(request.input.images?.length ? { ...this.config, textModel: this.config.visionModel || this.config.textModel } : this.config, secret, request.input, signal);
      }
      if (request.mode === 'image' && adapter.generateImage) {
        return await adapter.generateImage(this.config, secret, request.input, signal);
      }
      if (request.mode === 'inpaint' && adapter.inpaintImage) {
        return await adapter.inpaintImage({ ...this.config, imageModel: this.config.inpaintModel || this.config.imageModel }, secret, request.input, signal);
      }
      throw new ProviderError('此 Provider 不支援要求的能力', this.config.id, undefined, undefined, 'unsupported');
    } catch (error) {
      throw rebind(error, this.config.id);
    }
  }

  async testConnection(signal: AbortSignal): Promise<string> {
    const adapter = getAdapter(this.config.legacyAdapterId ?? adapterId(this.config));
    const secret = await secrets().get(this.config.secretRef);
    try {
      return await adapter.probe(this.config, secret, signal);
    } catch (error) {
      throw rebind(error, this.config.id);
    }
  }

  async getModels(signal: AbortSignal): Promise<string[]> {
    const adapter = getAdapter(this.config.legacyAdapterId ?? adapterId(this.config));
    const secret = await secrets().get(this.config.secretRef);
    if (adapter.getModels) return adapter.getModels(this.config, secret, signal);
    // 走 adapter 的 apiBase，模型列表才跟生成／測試用同一條補齊規則（例：自動補 /v1）。
    const base = adapter.apiBase ? adapter.apiBase(this.config) : trimSlash(this.config.baseUrl);
    if (!base) return [];
    try {
      const response = await getJson<{ data?: { id?: string }[] }>(
        `${base}/models`, authHeaders(this.config, secret), this.config.timeout * 1000, signal,
      );
      return response.data?.map((item) => item.id).filter((id): id is string => Boolean(id)) ?? [];
    } catch (error) {
      throw rebind(error, this.config.id);
    }
  }
}

/** Fully configurable JSON relay/API gateway provider. */
class CustomProvider extends AIProvider {
  async generate(request: ProviderRequest, signal: AbortSignal): Promise<ProviderResult> {
    const secret = await secrets().get(this.config.secretRef);
    // 文字／生圖／修圖各自可有獨立路徑，未設定時退回通用的 endpoint（舊設定行為不變）。
    const perMode = request.mode === 'text'
      ? this.config.textEndpoint
      : request.mode === 'inpaint'
        ? this.config.inpaintEndpoint
        : this.config.imageEndpoint;
    const url = authenticatedUrl(
      joinUrl(this.config.baseUrl, (perMode ?? '').trim() || this.config.endpoint, CUSTOM_API_PREFIX),
      this.config,
      secret,
    );
    const body = buildCustomBody(this.config, request);
    let response: JsonRecord;
    try {
      response = await postJson<JsonRecord>(
        url, body, authHeaders(this.config, secret), this.config.timeout * 1000, signal,
      );
    } catch (error) {
      throw rebind(error, this.config.id);
    }
    if (request.mode === 'text') {
      const text = readPath(response, this.config.responseFormat.textPath || 'choices.0.message.content');
      if (typeof text !== 'string' || !text.trim()) throw invalid(this.config.id, '文字回應路徑無有效內容');
      return text.trim();
    }
    const value = readPath(response, this.config.responseFormat.imagePath || 'data.0.b64_json');
    if (typeof value !== 'string' || !value) throw invalid(this.config.id, '影像回應路徑無有效內容');
    const base64 = /^https?:\/\//i.test(value)
      ? await fetchImageAsBase64(value, this.config.timeout * 1000, signal)
      : value.replace(/^data:image\/\w+;base64,/, '');
    return { base64, width: request.input.width, height: request.input.height, seed: request.input.seed };
  }

  async testConnection(signal: AbortSignal): Promise<string> {
    const models = await this.getModels(signal);
    return models.length ? `連線成功，可用模型 ${models.length} 個` : '連線成功';
  }

  async getModels(signal: AbortSignal): Promise<string[]> {
    const secret = await secrets().get(this.config.secretRef);
    const path = this.config.responseFormat.modelsPath || 'data';
    const url = authenticatedUrl(joinUrl(this.config.baseUrl, '/models', CUSTOM_API_PREFIX), this.config, secret);
    try {
      const response = await getJson<JsonRecord>(url, authHeaders(this.config, secret), this.config.timeout * 1000, signal);
      const items = readPath(response, path);
      if (!Array.isArray(items)) return [];
      return items.map((item) => typeof item === 'string' ? item : String((item as JsonRecord)?.id ?? '')).filter(Boolean);
    } catch (error) {
      throw rebind(error, this.config.id);
    }
  }
}

export class OpenAIProvider extends AdapterProvider {}
export class AnthropicProvider extends AdapterProvider {}
export class GeminiProvider extends AdapterProvider {}
export class OpenAICompatibleProvider extends AdapterProvider {}
export class LocalProvider extends AdapterProvider {}

export function createProvider(config: ProviderConfig): AIProvider {
  switch (config.type) {
    case 'openai': return new OpenAIProvider(config);
    case 'anthropic': return new AnthropicProvider(config);
    case 'gemini': return new GeminiProvider(config);
    case 'openai-compatible': return new OpenAICompatibleProvider(config);
    case 'custom': return new CustomProvider(config);
    case 'local': return new LocalProvider(config);
  }
}

function adapterId(config: ProviderConfig): LegacyProviderId {
  if (config.type === 'openai-compatible') return 'compatible' as const;
  if (config.type === 'local') return config.requestFormat.type === 'sd-webui' ? 'sd-webui' as const : 'ollama' as const;
  if (config.type === 'custom') return 'compatible';
  return config.type;
}

function authHeaders(config: ProviderConfig, secret: string): Record<string, string> {
  const headers = { ...config.headers };
  const auth = config.authentication;
  if (secret && (auth.type === 'bearer' || auth.type === 'api-key')) {
    headers[auth.headerName || (auth.type === 'bearer' ? 'Authorization' : 'X-API-Key')] = `${auth.prefix}${secret}`;
  }
  return headers;
}

function authenticatedUrl(url: string, config: ProviderConfig, secret: string): string {
  if (!secret || config.authentication.type !== 'query') return url;
  const parsed = new URL(url);
  parsed.searchParams.set(config.authentication.queryName || 'key', `${config.authentication.prefix}${secret}`);
  return parsed.toString();
}

/**
 * 自訂引擎沒有宣告自己的 API 版本前綴，比照 OpenAI 相容慣例補 /v1。
 * 使用者若在位址後自己帶了路徑（/api、/v2…）就以他填的為準，不會被覆蓋。
 */
const CUSTOM_API_PREFIX = '/v1';

function joinUrl(base: string, endpoint: string, prefix = ''): string {
  if (/^https?:\/\//i.test(endpoint)) return endpoint;
  return apiUrl(base, prefix, endpoint);
}

function buildCustomBody(config: ProviderConfig, request: ProviderRequest): unknown {
  const replacements: Record<string, unknown> = {
    model: request.mode === 'text' ? (request.input.images?.length ? config.visionModel || config.textModel : config.textModel) : request.mode === 'inpaint' ? (config.inpaintModel || config.imageModel) : config.imageModel,
    images: request.mode === 'text' ? request.input.images : undefined,
    mode: request.mode,
    prompt: request.mode === 'text' ? request.input.draft : request.input.prompt,
    subject: request.mode === 'text' ? request.input.subject : '',
    // 自訂請求格式的引擎也必須吃得到草稿階段的指令覆寫，否則只有內建引擎能用。
    systemPrompt: systemInstructionFor(request.mode === 'text' ? request.input : {}),
    ...(request.mode === 'text' ? {} : request.input),
  };
  const raw = config.requestFormat.template.trim();
  if (!raw) return replacements;
  try {
    return JSON.parse(raw, (_key, value) => {
      if (typeof value !== 'string') return value;
      const exact = value.match(/^\{\{([A-Za-z0-9_]+)\}\}$/);
      if (exact) return replacements[exact[1]] ?? '';
      return value.replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (_m, key: string) => String(replacements[key] ?? ''));
    });
  } catch {
    throw new ProviderError('Request Format 不是有效的 JSON', config.id, undefined, undefined, 'configuration');
  }
}

export function readPath(value: unknown, path: string): unknown {
  if (!path) return value;
  return path.split('.').reduce<unknown>((current, segment) => {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) return current[Number(segment)];
    if (typeof current === 'object') return (current as JsonRecord)[segment];
    return undefined;
  }, value);
}

function invalid(id: string, message: string): ProviderError {
  return new ProviderError(message, id, undefined, '請檢查 Response Format 路徑', 'invalid-response');
}

function rebind(error: unknown, id: string): ProviderError {
  if (error instanceof ProviderError) {
    return new ProviderError(error.message, id, error.status, error.hint, error.kind);
  }
  const status = (error as { status?: number })?.status;
  return new ProviderError(error instanceof Error ? error.message : String(error), id, status);
}
