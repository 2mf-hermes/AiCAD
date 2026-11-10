/* ============================================================================
   OpenAI 相容 adapter
   ----------------------------------------------------------------------------
   一份程式碼服務四種情境：官方 OpenAI、xAI Grok、第三方聚合／中轉站、
   以及 Ollama 的 /v1 相容端點。差別只在 baseUrl、預設模型與能力宣告，
   因此用工廠函式產生，避免四份幾乎一樣的檔案。
   ========================================================================== */

import { apiUrl, fetchImageAsBase64, getJson, isTimeout, postJson, postMultipart, withApiPrefix } from '../net/transport';
import { systemInstructionFor } from '../prompt/builder';
import {
  ProviderError,
  type GenerateImageInput,
  type InpaintImageInput,
  type ProviderAdapter,
  type ProviderCapabilities,
  type ProviderConfig,
  type ProviderId,
  type RefinePromptInput,
} from './types';

interface ChatResponse {
  choices?: { message?: { content?: string } }[];
}
interface ImageResponse {
  data?: { b64_json?: string; url?: string }[];
}
interface ModelListResponse {
  data?: { id?: string }[];
}

function authHeaders(cfg: ProviderConfig, secret: string): Record<string, string> {
  const h: Record<string, string> = { ...cfg.headers };
  const auth = cfg.authentication;
  if (secret && (auth.type === 'bearer' || auth.type === 'api-key')) {
    h[auth.headerName || (auth.type === 'bearer' ? 'Authorization' : 'X-API-Key')] = `${auth.prefix}${secret}`;
  }
  return h;
}

/** 有效 API 根位址：使用者填的位址若沒帶路徑，自動補上版本前綴（例：/v1）。 */
function baseFor(cfg: ProviderConfig, fallback: string, prefix: string): string {
  return withApiPrefix(cfg.baseUrl || fallback, prefix);
}

/** 依呼叫種類挑選對應的端點路徑（文字／生圖／修圖各自獨立）。
    未設定時回傳空字串，由呼叫端退回通用的 `endpoint`，確保舊設定行為不變。 */
function operationEndpoint(cfg: ProviderConfig, operation: string): string {
  if (operation === 'chat/completions') return (cfg.textEndpoint ?? '').trim();
  if (operation === 'images/generations') return (cfg.imageEndpoint ?? '').trim();
  if (operation === 'images/edits') return (cfg.inpaintEndpoint ?? '').trim();
  return '';
}

function endpoint(
  cfg: ProviderConfig,
  fallback: string,
  operation: string,
  secret: string,
  prefix: string,
): string {
  const configured = operationEndpoint(cfg, operation) || cfg.endpoint.trim();
  let url: string;
  if (!configured) url = apiUrl(cfg.baseUrl || fallback, prefix, `/${operation}`);
  else {
    const path = configured.replace(/\{operation\}/g, operation);
    url = /^https?:\/\//i.test(path) ? path : apiUrl(cfg.baseUrl || fallback, prefix, path);
  }
  if (!secret || cfg.authentication.type !== 'query') return url;
  const parsed = new URL(url);
  parsed.searchParams.set(cfg.authentication.queryName || 'key', `${cfg.authentication.prefix}${secret}`);
  return parsed.toString();
}

interface Spec {
  id: ProviderAdapter['id'];
  displayName: string;
  baseUrl: string;
  textModel: string;
  imageModel: string;
  capabilities: ProviderCapabilities;
  isLocal: boolean;
  /** 位址未帶路徑時要自動補上的 API 版本前綴；預設 '/v1'。 */
  apiPrefix?: string;
}

export function createOpenAICompatibleAdapter(spec: Spec): ProviderAdapter {
  const prefix = spec.apiPrefix ?? '/v1';
  const adapter: ProviderAdapter = {
    id: spec.id,
    displayName: spec.displayName,
    capabilities: spec.capabilities,
    isLocal: spec.isLocal,
    defaults: { baseUrl: spec.baseUrl, textModel: spec.textModel, imageModel: spec.imageModel },
    apiBase: (cfg) => baseFor(cfg, spec.baseUrl, prefix),

    async probe(cfg, secret, signal) {
      const url = endpoint(cfg, spec.baseUrl, 'models', secret, prefix);
      try {
        const res = await getJson<ModelListResponse>(
          url,
          authHeaders(cfg, secret),
          cfg.timeoutSec * 1000,
          signal,
        );
        const n = res.data?.length ?? 0;
        return n > 0 ? `連線成功，可用模型 ${n} 個` : '連線成功（端點未回報模型清單）';
      } catch (e) {
        throw wrap(e, spec.id);
      }
    },

    async refinePrompt(cfg, secret, input: RefinePromptInput, signal) {
      if (!spec.capabilities.text) throw new ProviderError('此引擎不支援文字精煉', spec.id);
      const url = endpoint(cfg, spec.baseUrl, 'chat/completions', secret, prefix);
      try {
        const res = await postJson<ChatResponse>(
          url,
          {
            model: cfg.textModel || spec.textModel,
            messages: [
              { role: 'system', content: systemInstructionFor(input) },
              { role: 'user', content: input.images?.length ? [
                { type: 'text', text: `Describe the attached reference geometry accurately. ${input.subject}\n${input.draft}` },
                ...input.images.map(image => ({ type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${image.base64}` } })),
              ] : `Part description: ${input.subject}\n\nDraft brief:\n${input.draft}` },
            ],
            temperature: 0.2,
          },
          authHeaders(cfg, secret),
          cfg.timeoutSec * 1000,
          signal,
        );
        const text = res.choices?.[0]?.message?.content?.trim();
        if (!text) throw new ProviderError('模型回應為空', spec.id);
        return text;
      } catch (e) {
        throw wrap(e, spec.id);
      }
    },

    async generateImage(cfg, secret, input: GenerateImageInput, signal) {
      if (!spec.capabilities.imageGenerate) throw new ProviderError('此引擎不支援影像生成', spec.id);
      const prompt = input.referenceNotes
        ? `${input.prompt}\n\nReference material:\n${input.referenceNotes}`
        : input.prompt;
      try {
        if (input.images?.length) {
          const url = endpoint(cfg, spec.baseUrl, 'images/edits', secret, prefix);
          const res = await postMultipart<ImageResponse>(
            url,
            [
              ...input.images.map((image, index) => ({
                name: 'image[]',
                filename: `reference-${index}.${image.mimeType.split('/')[1] || 'png'}`,
                contentType: image.mimeType,
                base64: image.base64,
              })),
              { name: 'prompt', value: prompt },
              { name: 'model', value: cfg.imageModel || spec.imageModel },
              { name: 'size', value: 'auto' },
              { name: 'n', value: '1' },
              { name: 'response_format', value: 'b64_json' },
            ],
            authHeaders(cfg, secret),
            cfg.timeoutSec * 1000,
            signal,
          );
          const first = res.data?.[0];
          const base64 = first?.b64_json
            ?? (first?.url ? await fetchImageAsBase64(first.url, cfg.timeoutSec * 1000, signal) : undefined);
          if (!base64) {
            throw new ProviderError(
              '端點沒有回傳影像（既無 b64_json 也無 url）',
              spec.id,
              undefined,
              '請確認模型與端點支援 /images/edits 參考圖輸入',
              'invalid-response',
            );
          }
          return { base64, width: input.width, height: input.height, seed: input.seed };
        }

        const url = endpoint(cfg, spec.baseUrl, 'images/generations', secret, prefix);
        const res = await postJson<ImageResponse>(
          url,
          {
            model: cfg.imageModel || spec.imageModel,
            prompt,
            size: `${input.width}x${input.height}`,
            n: 1,
            response_format: 'b64_json',
          },
          authHeaders(cfg, secret),
          cfg.timeoutSec * 1000,
          signal,
        );
        const first = res.data?.[0];
        const b64 = first?.b64_json;
        if (b64) {
          return { base64: b64, width: input.width, height: input.height, seed: input.seed };
        }

        // 第二種形狀：只回 url。大量第三方聚合／中轉站是這樣（有些甚至忽略
        // response_format）。此時要自己把圖抓回來 —— 過去這裡直接放棄，
        // 使用者的體感就是「送出了但永遠拿不到圖」。
        if (first?.url) {
          const downloaded = await fetchImageAsBase64(first.url, cfg.timeoutSec * 1000, signal);
          return {
            base64: downloaded,
            width: input.width,
            height: input.height,
            seed: input.seed,
          };
        }

        throw new ProviderError(
          '端點沒有回傳影像（既無 b64_json 也無 url）',
          spec.id,
          undefined,
          '請確認模型名稱是出圖模型，且 Base URL 指向支援 /images/generations 的端點',
        );
      } catch (e) {
        throw wrap(e, spec.id);
      }
    },
  };

  if (spec.capabilities.imageInpaint) {
    adapter.inpaintImage = async (cfg, secret, input: InpaintImageInput, signal) => {
      const url = endpoint(cfg, spec.baseUrl, 'images/edits', secret, prefix);
      try {
        const openAIMask = await toOpenAIAlphaMask(input.maskBase64);
        const res = await postMultipart<ImageResponse>(
          url,
          [
            { name: 'image', filename: 'image.png', contentType: 'image/png', base64: input.imageBase64 },
            { name: 'mask', filename: 'mask.png', contentType: 'image/png', base64: openAIMask },
            { name: 'prompt', value: input.prompt },
            { name: 'model', value: cfg.imageModel || spec.imageModel },
            { name: 'size', value: 'auto' },
            { name: 'n', value: '1' },
            { name: 'response_format', value: 'b64_json' },
          ],
          authHeaders(cfg, secret),
          cfg.timeoutSec * 1000,
          signal,
        );
        const first = res.data?.[0];
        const base64 = first?.b64_json ?? (first?.url
          ? await fetchImageAsBase64(first.url, cfg.timeoutSec * 1000, signal)
          : undefined);
        if (!base64) throw new ProviderError(
          '局部重繪端點沒有回傳影像（既無 b64_json 也無 url）',
          spec.id,
          undefined,
          '請確認端點支援 OpenAI /images/edits multipart 格式',
          'invalid-response',
        );
        return { base64, width: input.width, height: input.height, seed: input.seed };
      } catch (e) {
        throw wrap(e, spec.id);
      }
    };
  }

  return adapter;
}

async function toOpenAIAlphaMask(maskBase64: string): Promise<string> {
  const image = new Image();
  image.src = `data:image/png;base64,${maskBase64.replace(/^data:[^;]+;base64,/, '')}`;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('無法建立 OpenAI 遮罩轉換畫布');
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let offset = 0; offset < pixels.data.length; offset += 4) {
    const selected = pixels.data[offset] + pixels.data[offset + 1] + pixels.data[offset + 2] >= 384;
    pixels.data[offset] = 0;
    pixels.data[offset + 1] = 0;
    pixels.data[offset + 2] = 0;
    pixels.data[offset + 3] = selected ? 0 : 255;
  }
  context.putImageData(pixels, 0, 0);
  return canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
}

function wrap(e: unknown, id: ProviderId): ProviderError {
  if (e instanceof ProviderError) return e;
  const msg = e instanceof Error ? e.message : String(e);
  const status = (e as { status?: number })?.status;
  let hint: string | undefined;
  if (status === 401 || status === 403) hint = '請確認 API Key 與端點是否相符';
  else if (status === 404) hint = 'Base URL 或端點路徑不符；Base URL 只填服務位址就好，路徑由程式自動補齊';
  else if (status === 429) hint = '已達速率上限，稍後重試或降低併發';
  else if (isTimeout(e) || /timeout|逾時|abort/i.test(msg))
    hint = '請在該引擎設定中調高「逾時秒數」；本地模型或高解析度出圖需要更長時間';
  return new ProviderError(msg, id, status, hint);
}
