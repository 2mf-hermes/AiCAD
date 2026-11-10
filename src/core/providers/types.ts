/* Provider abstraction shared by settings, runtime instances and UI. */

export type LegacyProviderId =
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'xai'
  | 'compatible'
  | 'sd-webui'
  | 'comfyui'
  | 'ollama';

/** Stable instance id. It is deliberately not tied to a provider type. */
export type ProviderId = string;
export type ProviderType =
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'openai-compatible'
  | 'custom'
  | 'local';
export type ProviderMode = 'text' | 'image' | 'inpaint';
export type AuthenticationType = 'none' | 'bearer' | 'api-key' | 'query';

export interface ProviderCapabilities {
  text: boolean;
  imageGenerate: boolean;
  imageInpaint: boolean;
  vision: boolean;
}

export interface ProviderAuthentication {
  type: AuthenticationType;
  headerName: string;
  queryName: string;
  prefix: string;
}

export interface ProviderRequestFormat {
  /** Built-in dialect, or a JSON template for custom gateways. */
  type: 'openai' | 'anthropic' | 'gemini' | 'sd-webui' | 'custom';
  template: string;
}

export interface ProviderResponseFormat {
  type: 'openai' | 'anthropic' | 'gemini' | 'sd-webui' | 'custom';
  textPath: string;
  imagePath: string;
  modelsPath: string;
}

/** Persisted configuration. apiKey is represented by secretRef and never serialized here. */
export interface ProviderConfig {
  id: ProviderId;
  type: ProviderType;
  name: string;
  enabled: boolean;
  baseUrl: string;
  endpoint: string;
  /** per-provider-type endpoint path override — text model (prompt refinement) */
  textEndpoint: string;
  /** per-provider-type endpoint path override — image generation */
  imageEndpoint: string;
  /** per-provider-type endpoint path override — inpainting */
  inpaintEndpoint: string;
  secretRef: string;
  model: string;
  /** 主文字模型：精煉、文字生成。 */
  textModel: string;
  /** 視圖模型：圖片辨識；空值時跟隨主文字模型。 */
  visionModel: string;
  /** 主生圖模型：full image generation。 */
  imageModel: string;
  /** 局部重繪模型；空值時跟隨主生圖模型。 */
  inpaintModel: string;
  fallbackEnabled: boolean;
  textFallbackEnabled: boolean;
  imageFallbackEnabled: boolean;
  priority: number;
  /** whole-run safety timeout (back-compat alias) */
  timeout: number;
  retryCount: number;
  headers: Record<string, string>;
  requestFormat: ProviderRequestFormat;
  responseFormat: ProviderResponseFormat;
  authentication: ProviderAuthentication;
  capabilities: ProviderCapabilities;
  /** per-model-type timeout: text model (prompt refinement) */
  textTimeout: number;
  /** per-model-type timeout: image model (generation/inpaint) */
  imageTimeout: number;

  /** v2 compatibility aliases; normalized settings always populate these. */
  label: string;
  timeoutSec: number;
  legacyAdapterId?: LegacyProviderId;
}

export interface RefinePromptInput {
  draft: string;
  subject: string;
  textLanguage?: string;
  images?: { mimeType: string; base64: string }[];
  /**
   * 覆寫系統指令。預設（未提供）沿用提示與精煉用的 REFINE_SYSTEM_PROMPT。
   * 草稿階段需要完全不同的指令（輸出 SVG 幾何而不是幾何描述），
   * 若為此再開一個 provider 模式，三種引擎都要各加一條分支，
   * 不如讓呼叫端把指令帶進來 —— 引擎只負責送達。
   */
  systemPrompt?: string;
  /**
   * 這一輪的附加指令；有值時會附在系統指令之後。
   * 與 systemPrompt 分開，是為了不必把固定規則複製到每個呼叫端。
   */
  instruction?: string;
}

export interface GenerateImageInput {
  prompt: string;
  negativePrompt?: string;
  width: number;
  height: number;
  seed?: number;
  steps?: number;
  /** 參考圖（base64 無 data: 前綴）；支援的引擎會當成圖像條件送出。 */
  images?: { mimeType: string; base64: string }[];
  /** 文字參考檔內容；引擎可自行決定併入提示詞。 */
  referenceNotes?: string;
}

export interface InpaintImageInput extends GenerateImageInput {
  imageBase64: string;
  maskBase64: string;
  denoise?: number;
}

export interface ImageResult {
  base64: string;
  width: number;
  height: number;
  seed?: number;
}

export type ProviderRequest =
  | { mode: 'text'; input: RefinePromptInput }
  | { mode: 'image'; input: GenerateImageInput }
  | { mode: 'inpaint'; input: InpaintImageInput };
export type ProviderResult = string | ImageResult;

export abstract class AIProvider {
  constructor(readonly config: ProviderConfig) {}
  abstract generate(request: ProviderRequest, signal: AbortSignal): Promise<ProviderResult>;
  abstract testConnection(signal: AbortSignal): Promise<string>;
  abstract getModels(signal: AbortSignal): Promise<string[]>;
}

/** Legacy adapter port retained behind the instance provider factory. */
export interface ProviderAdapter {
  readonly id: LegacyProviderId;
  readonly displayName: string;
  readonly capabilities: ProviderCapabilities;
  readonly defaults: Pick<ProviderConfig, 'baseUrl' | 'textModel' | 'imageModel'>;
  readonly isLocal: boolean;
  /**
   * 有效 API 根位址：使用者只填服務位址時自動補上 API 版本路徑（例：/v1）。
   * 模型列表等共用路徑都必須走這裡，才不會繞過補齊規則。
   */
  apiBase?(cfg: ProviderConfig): string;
  probe(cfg: ProviderConfig, secret: string, signal: AbortSignal): Promise<string>;
  getModels?(cfg: ProviderConfig, secret: string, signal: AbortSignal): Promise<string[]>;
  refinePrompt?(cfg: ProviderConfig, secret: string, input: RefinePromptInput, signal: AbortSignal): Promise<string>;
  generateImage?(cfg: ProviderConfig, secret: string, input: GenerateImageInput, signal: AbortSignal): Promise<ImageResult>;
  inpaintImage?(cfg: ProviderConfig, secret: string, input: InpaintImageInput, signal: AbortSignal): Promise<ImageResult>;
}

export type ProviderErrorKind =
  | 'configuration'
  | 'rate-limit'
  | 'server'
  | 'timeout'
  | 'network'
  | 'invalid-response'
  | 'unsupported'
  | 'cancelled'
  | 'unknown';

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly providerId: ProviderId,
    readonly status?: number,
    readonly hint?: string,
    readonly kind: ProviderErrorKind = inferProviderErrorKind(status, message),
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export function inferProviderErrorKind(status?: number, message = ''): ProviderErrorKind {
  if (status === 401 || status === 403) return 'configuration';
  if (status === 429) return 'rate-limit';
  if (status !== undefined && status >= 500) return 'server';
  if (/timeout|timed out|逾時/i.test(message)) return 'timeout';
  if (/abort|cancel/i.test(message)) return 'cancelled';
  if (/json|response|回應|base64|image data|影像資料/i.test(message)) return 'invalid-response';
  if (/network|fetch|connection|econn|socket|dns/i.test(message)) return 'network';
  return 'unknown';
}

export function isRetryableProviderError(error: ProviderError): boolean {
  return ['rate-limit', 'server', 'timeout', 'network'].includes(error.kind);
}
