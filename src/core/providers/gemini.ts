/* ============================================================================
   Google Gemini adapter
   ----------------------------------------------------------------------------
   Gemini 同時具備文字與影像能力，影像走 :generateContent 並在回應的
   inlineData 中夾帶 base64，格式與 OpenAI 完全不同，所以獨立成檔。
   ========================================================================== */

import { postJson, trimSlash } from '../net/transport';
import { systemInstructionFor } from '../prompt/builder';
import { ProviderError, type ProviderAdapter, type ProviderConfig } from './types';

const DEFAULT_BASE = 'https://generativelanguage.googleapis.com/v1beta';

interface Part {
  text?: string;
  inlineData?: { mimeType?: string; data?: string };
}
interface GenerateContentResponse {
  candidates?: { content?: { parts?: Part[] } }[];
}

function headers(cfg: ProviderConfig, secret: string): Record<string, string> {
  return { 'x-goog-api-key': secret, ...cfg.headers };
}

/** Gemini 端點固定為 /models/{model}:generateContent；若使用者另外指定了
    文字／生圖／修圖路徑，則改用該路徑（同樣支援 {model} 佔位符）。 */
function endpoint(cfg: ProviderConfig, model: string, kind: 'text' | 'image'): string {
  const override = (kind === 'text' ? cfg.textEndpoint : cfg.imageEndpoint ?? '').trim();
  const path = (override || `/models/${model}:generateContent`).replace(/\{model\}/g, model);
  if (/^https?:\/\//i.test(path)) return path;
  return `${trimSlash(cfg.baseUrl || DEFAULT_BASE)}${path.startsWith('/') ? path : `/${path}`}`;
}

export const geminiAdapter: ProviderAdapter = {
  id: 'gemini',
  displayName: 'Google Gemini',
  isLocal: false,
  capabilities: { text: true, imageGenerate: true, imageInpaint: true, vision: true },
  defaults: {
    baseUrl: DEFAULT_BASE,
    textModel: 'gemini-2.5-flash',
    imageModel: 'gemini-2.5-flash-image',
  },

  async probe(cfg, secret, signal) {
    try {
      await postJson<GenerateContentResponse>(
        endpoint(cfg, cfg.textModel || 'gemini-2.5-flash', 'text'),
        { contents: [{ parts: [{ text: 'ping' }] }] },
        headers(cfg, secret),
        cfg.timeoutSec * 1000,
        signal,
      );
      return '連線成功，Gemini 文字與影像通道就緒';
    } catch (e) {
      throw toProviderError(e);
    }
  },

  async refinePrompt(cfg, secret, input, signal) {
    try {
      const res = await postJson<GenerateContentResponse>(
        endpoint(cfg, cfg.textModel || 'gemini-2.5-flash', 'text'),
        {
          systemInstruction: { parts: [{ text: systemInstructionFor(input) }] },
          contents: [
            {
              parts: [
                { text: `Part description: ${input.subject}\n\nDraft brief:\n${input.draft}` },
                ...(input.images ?? []).map(image => ({ inlineData: { mimeType: image.mimeType, data: image.base64 } })),
              ],
            },
          ],
          generationConfig: { temperature: 0.2 },
        },
        headers(cfg, secret),
        cfg.timeoutSec * 1000,
        signal,
      );
      const text = firstText(res);
      if (!text) throw new ProviderError('模型回應為空', 'gemini');
      return text;
    } catch (e) {
      throw toProviderError(e);
    }
  },

  async generateImage(cfg, secret, input, signal) {
    try {
      const res = await postJson<GenerateContentResponse>(
        endpoint(cfg, cfg.imageModel || 'gemini-2.5-flash-image', 'image'),
        {
          contents: [
            {
              parts: [
                ...(input.images ?? []).map(image => ({ inlineData: { mimeType: image.mimeType, data: image.base64 } })),
                ...(input.referenceNotes ? [{ text: `Reference material:\n${input.referenceNotes}` }] : []),
                { text: input.prompt },
              ],
            },
          ],
        },
        headers(cfg, secret),
        cfg.timeoutSec * 1000,
        signal,
      );
      const b64 = firstImage(res);
      if (!b64) throw new ProviderError('回應未包含影像資料', 'gemini');
      return { base64: b64, width: input.width, height: input.height, seed: input.seed };
    } catch (e) {
      throw toProviderError(e);
    }
  },

  async inpaintImage(cfg, secret, input, signal) {
    // Gemini 的編輯方式是把原圖 + 遮罩 + 指令一起送入多模態上下文，
    // 由模型自行推論編輯範圍；沒有專用的 mask 參數。
    try {
      const res = await postJson<GenerateContentResponse>(
        endpoint(cfg, cfg.imageModel || 'gemini-2.5-flash-image', 'image'),
        {
          contents: [
            {
              parts: [
                { inlineData: { mimeType: 'image/png', data: input.imageBase64 } },
                { inlineData: { mimeType: 'image/png', data: input.maskBase64 } },
                {
                  text:
                    `${input.prompt}\n\n` +
                    'The second image is a mask: pure white marks the region to modify, ' +
                    'pure black marks the region that must remain pixel-identical. ' +
                    'Return the full edited sheet at the same dimensions.',
                },
              ],
            },
          ],
        },
        headers(cfg, secret),
        cfg.timeoutSec * 1000,
        signal,
      );
      const b64 = firstImage(res);
      if (!b64) throw new ProviderError('回應未包含影像資料', 'gemini');
      return { base64: b64, width: input.width, height: input.height, seed: input.seed };
    } catch (e) {
      throw toProviderError(e);
    }
  },
};

function firstText(res: GenerateContentResponse): string | undefined {
  return res.candidates?.[0]?.content?.parts?.find((p) => p.text)?.text?.trim();
}
function firstImage(res: GenerateContentResponse): string | undefined {
  return res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData?.data;
}

function toProviderError(e: unknown): ProviderError {
  if (e instanceof ProviderError) return e;
  const msg = e instanceof Error ? e.message : String(e);
  const status = (e as { status?: number })?.status;
  const hint =
    status === 400
      ? '模型名稱可能不存在於此 API 版本'
      : status === 403
        ? 'API Key 未啟用 Generative Language API'
        : undefined;
  return new ProviderError(msg, 'gemini', status, hint);
}
