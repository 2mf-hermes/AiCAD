/* ============================================================================
   本地 Stable Diffusion adapter (AUTOMATIC1111 / Forge / reForge)
   ----------------------------------------------------------------------------
   這是 Ai Cad 局部重繪的主力：A1111 的 /sdapi/v1/img2img 原生支援 mask、
   inpaint_full_res 與 denoising_strength，是唯一能真正「只改選區、其餘像素
   不動」的路徑。本機服務沒有 API Key，也沒有速率限制，逾時要設得更寬。
   ========================================================================== */

import { getJson, postJson, trimSlash } from '../net/transport';
import { ProviderError, type ProviderAdapter, type ProviderConfig } from './types';

const DEFAULT_BASE = 'http://127.0.0.1:7860';

interface SdImageResponse {
  images?: string[];
  info?: string;
}
interface SdOptions {
  sd_model_checkpoint?: string;
}

function url(cfg: ProviderConfig, path: string): string {
  return `${trimSlash(cfg.baseUrl || DEFAULT_BASE)}${path}`;
}

export const sdWebuiAdapter: ProviderAdapter = {
  id: 'sd-webui',
  displayName: '本地 Stable Diffusion (A1111)',
  isLocal: true,
  capabilities: { text: false, imageGenerate: true, imageInpaint: true, vision: false },
  defaults: { baseUrl: DEFAULT_BASE, textModel: '', imageModel: '' },

  async probe(cfg, _secret, signal) {
    try {
      const opt = await getJson<SdOptions>(
        url(cfg, '/sdapi/v1/options'),
        cfg.headers,
        cfg.timeoutSec * 1000,
        signal,
      );
      return opt.sd_model_checkpoint
        ? `已連線，目前模型：${opt.sd_model_checkpoint}`
        : '已連線（未回報模型名稱）';
    } catch (e) {
      throw toProviderError(
        e,
        'A1111 需以 --api 參數啟動，且 Base URL 預設為 http://127.0.0.1:7860',
      );
    }
  },

  async generateImage(cfg, _secret, input, signal) {
    try {
      const res = await postJson<SdImageResponse>(
        url(cfg, '/sdapi/v1/txt2img'),
        {
          prompt: input.prompt,
          negative_prompt: input.negativePrompt ?? '',
          width: input.width,
          height: input.height,
          steps: input.steps ?? 30,
          cfg_scale: 6.5,
          seed: input.seed ?? -1,
          sampler_name: 'DPM++ 2M',
          override_settings: cfg.imageModel
            ? { sd_model_checkpoint: cfg.imageModel }
            : undefined,
        },
        cfg.headers,
        cfg.timeoutSec * 1000,
        signal,
      );
      return unwrap(res, input.width, input.height, input.seed);
    } catch (e) {
      throw toProviderError(e);
    }
  },

  async inpaintImage(cfg, _secret, input, signal) {
    try {
      const res = await postJson<SdImageResponse>(
        url(cfg, '/sdapi/v1/img2img'),
        {
          init_images: [input.imageBase64],
          mask: input.maskBase64,
          prompt: input.prompt,
          negative_prompt: input.negativePrompt ?? '',
          width: input.width,
          height: input.height,
          steps: input.steps ?? 32,
          cfg_scale: 6.5,
          seed: input.seed ?? -1,
          // 0.72 是實測在「加細節但不破壞既有線條」之間的平衡點
          denoising_strength: input.denoise ?? 0.72,
          mask_blur: 6,
          inpainting_fill: 1,       // 1 = original，保留底圖線條作為引導
          inpaint_full_res: true,   // 只在選區裁切區域全解析度運算，細節最好
          inpaint_full_res_padding: 48,
          inpainting_mask_invert: 0, // 白色 = 重繪區
        },
        cfg.headers,
        cfg.timeoutSec * 1000,
        signal,
      );
      return unwrap(res, input.width, input.height, input.seed);
    } catch (e) {
      throw toProviderError(e);
    }
  },
};

function unwrap(
  res: SdImageResponse,
  width: number,
  height: number,
  seed?: number,
) {
  const b64 = res.images?.[0];
  if (!b64) throw new ProviderError('本地服務未回傳影像', 'sd-webui');
  return { base64: b64, width, height, seed };
}

function toProviderError(e: unknown, hint?: string): ProviderError {
  if (e instanceof ProviderError) return e;
  const msg = e instanceof Error ? e.message : String(e);
  return new ProviderError(msg, 'sd-webui', (e as { status?: number })?.status, hint);
}
