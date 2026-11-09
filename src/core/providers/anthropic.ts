/* ============================================================================
   Anthropic (Claude) adapter
   ----------------------------------------------------------------------------
   Claude 沒有影像生成能力，所以它在 Ai Cad 的角色是「圖面顧問」：
   把模糊描述編譯成精確的幾何敘述，交給繪圖引擎。這正是拆分
   TextCapability / ImageCapability 的價值。
   ========================================================================== */

import { postJson, trimSlash } from '../net/transport';
import { systemInstructionFor } from '../prompt/builder';
import { ProviderError, type ProviderAdapter, type ProviderConfig } from './types';

const DEFAULT_BASE = 'https://api.anthropic.com/v1';
const API_VERSION = '2023-06-01';

interface MessagesResponse {
  content?: { type?: string; text?: string }[];
}

function headers(cfg: ProviderConfig, secret: string): Record<string, string> {
  return {
    'x-api-key': secret,
    'anthropic-version': API_VERSION,
    // 桌面應用透過原生端發請求時不需要，但開發期走 WebView 需要這個標頭
    'anthropic-dangerous-direct-browser-access': 'true',
    ...cfg.headers,
  };
}

export const anthropicAdapter: ProviderAdapter = {
  id: 'anthropic',
  displayName: 'Anthropic Claude',
  isLocal: false,
  capabilities: { text: true, imageGenerate: false, imageInpaint: false, vision: true },
  defaults: {
    baseUrl: DEFAULT_BASE,
    textModel: 'claude-sonnet-4-5',
    imageModel: '',
  },

  async probe(cfg, secret, signal) {
    // 文字模型可指定獨立路徑；未設定則沿用既有的 /messages。
    const path = (cfg.textEndpoint ?? '').trim() || '/messages';
    const url = /^https?:\/\//i.test(path)
      ? path
      : `${trimSlash(cfg.baseUrl || DEFAULT_BASE)}${path.startsWith('/') ? path : `/${path}`}`;
    try {
      await postJson<MessagesResponse>(
        url,
        {
          model: cfg.textModel || 'claude-sonnet-4-5',
          max_tokens: 8,
          messages: [{ role: 'user', content: 'ping' }],
        },
        headers(cfg, secret),
        cfg.timeoutSec * 1000,
        signal,
      );
      return '連線成功，Claude 可用於提示語精煉與圖面複核';
    } catch (e) {
      throw toProviderError(e);
    }
  },

  async refinePrompt(cfg, secret, input, signal) {
    // 文字模型可指定獨立路徑；未設定則沿用既有的 /messages。
    const path = (cfg.textEndpoint ?? '').trim() || '/messages';
    const url = /^https?:\/\//i.test(path)
      ? path
      : `${trimSlash(cfg.baseUrl || DEFAULT_BASE)}${path.startsWith('/') ? path : `/${path}`}`;
    try {
      const res = await postJson<MessagesResponse>(
        url,
        {
          model: cfg.textModel || 'claude-sonnet-4-5',
          max_tokens: 700,
          system: systemInstructionFor(input),
          messages: [
            {
              role: 'user',
              content: input.images?.length ? [
                ...input.images.map(image => ({ type: 'image', source: { type: 'base64', media_type: image.mimeType, data: image.base64 } })),
                { type: 'text', text: `Describe reference geometry accurately. ${input.subject}\n${input.draft}` },
              ] : `Part description: ${input.subject}\n\nDraft brief:\n${input.draft}`,
            },
          ],
        },
        headers(cfg, secret),
        cfg.timeoutSec * 1000,
        signal,
      );
      const text = res.content?.find((b) => b.type === 'text')?.text?.trim();
      if (!text) throw new ProviderError('模型回應為空', 'anthropic');
      return text;
    } catch (e) {
      throw toProviderError(e);
    }
  },
};

function toProviderError(e: unknown): ProviderError {
  if (e instanceof ProviderError) return e;
  const msg = e instanceof Error ? e.message : String(e);
  const status = (e as { status?: number })?.status;
  const hint =
    status === 401
      ? 'x-api-key 無效'
      : status === 404
        ? 'Base URL 需以 /v1 結尾'
        : undefined;
  return new ProviderError(msg, 'anthropic', status, hint);
}
