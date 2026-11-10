/* ============================================================================
   Provider 註冊表 (Registry)
   ----------------------------------------------------------------------------
   唯一一處知道「有哪些引擎存在」的地方。UI 只查詢這裡，
   新增引擎 = 加一行，不需修改任何面板程式碼。
   ========================================================================== */

import { anthropicAdapter } from './anthropic';
import { geminiAdapter } from './gemini';
import { createOpenAICompatibleAdapter } from './openaiCompatible';
import { sdWebuiAdapter } from './sdWebui';
import type { LegacyProviderId, ProviderAdapter, ProviderConfig, ProviderType } from './types';

const openaiAdapter = createOpenAICompatibleAdapter({
  id: 'openai',
  displayName: 'OpenAI',
  // 只填服務位址，/v1 由 adapter 依 apiPrefix 自動補齊。
  baseUrl: 'https://api.openai.com',
  apiPrefix: '/v1',
  textModel: 'gpt-5',
  imageModel: 'gpt-image-1',
  capabilities: { text: true, imageGenerate: true, imageInpaint: true, vision: true },
  isLocal: false,
});

const xaiAdapter = createOpenAICompatibleAdapter({
  id: 'xai',
  displayName: 'xAI Grok',
  baseUrl: 'https://api.x.ai',
  apiPrefix: '/v1',
  textModel: 'grok-4',
  imageModel: 'grok-2-image',
  capabilities: { text: true, imageGenerate: true, imageInpaint: false, vision: true },
  isLocal: false,
});

const compatibleAdapter = createOpenAICompatibleAdapter({
  id: 'compatible',
  displayName: '自訂 / 聚合中轉站',
  baseUrl: '',
  apiPrefix: '/v1',
  textModel: '',
  imageModel: '',
  // 中轉站能力未知，全開讓使用者自行嘗試，錯誤訊息會如實回報
  capabilities: { text: true, imageGenerate: true, imageInpaint: true, vision: true },
  isLocal: false,
});

const ollamaAdapter = createOpenAICompatibleAdapter({
  id: 'ollama',
  displayName: '本地 Ollama',
  baseUrl: 'http://127.0.0.1:11434',
  apiPrefix: '/v1',
  textModel: 'qwen3:8b',
  imageModel: '',
  capabilities: { text: true, imageGenerate: false, imageInpaint: false, vision: true },
  isLocal: true,
});

export const ADAPTERS: readonly ProviderAdapter[] = [
  openaiAdapter,
  anthropicAdapter,
  geminiAdapter,
  xaiAdapter,
  compatibleAdapter,
  sdWebuiAdapter,
  ollamaAdapter,
];

const BY_ID = new Map<LegacyProviderId, ProviderAdapter>(ADAPTERS.map((a) => [a.id, a]));

export function getAdapter(id: LegacyProviderId): ProviderAdapter {
  const a = BY_ID.get(id);
  if (!a) throw new Error(`未註冊的引擎：${id}`);
  return a;
}

/** 依 adapter 預設值建立一份空白設定 */
const TYPE_BY_LEGACY: Record<LegacyProviderId, ProviderType> = {
  openai: 'openai', anthropic: 'anthropic', gemini: 'gemini', xai: 'openai-compatible',
  compatible: 'openai-compatible', 'sd-webui': 'local', comfyui: 'local', ollama: 'local',
};

export function createDefaultConfig(id: LegacyProviderId, instanceId: string = id): ProviderConfig {
  const a = getAdapter(id);
  return {
    id: instanceId,
    type: TYPE_BY_LEGACY[id],
    name: a.displayName,
    enabled: false,
    label: a.displayName,
    baseUrl: a.defaults.baseUrl,
    endpoint: '',
    textEndpoint: '',
    imageEndpoint: '',
    inpaintEndpoint: '',
    secretRef: `aicad.secret.${instanceId}`,
    model: a.defaults.imageModel || a.defaults.textModel,
    textModel: a.defaults.textModel,
    visionModel: '',
    imageModel: a.defaults.imageModel,
    inpaintModel: '',
    fallbackEnabled: true,
    textFallbackEnabled: true,
    imageFallbackEnabled: true,
    headers: {},
    priority: ADAPTERS.findIndex((candidate) => candidate.id === id) + 1,
    timeout: a.isLocal ? 300 : 90,               // whole-run back-compat alias
    textTimeout: a.isLocal ? 300 : 90,           // per-model: text
    imageTimeout: a.isLocal ? 300 : 90,          // per-model: image
    retryCount: 1,
    requestFormat: {
      type: id === 'anthropic' ? 'anthropic' : id === 'gemini' ? 'gemini' : id === 'sd-webui' ? 'sd-webui' : 'openai',
      template: '',
    },
    responseFormat: {
      type: id === 'anthropic' ? 'anthropic' : id === 'gemini' ? 'gemini' : id === 'sd-webui' ? 'sd-webui' : 'openai',
      textPath: '', imagePath: '', modelsPath: '',
    },
    authentication: a.isLocal
      ? { type: 'none', headerName: '', queryName: '', prefix: '' }
      : id === 'anthropic'
        ? { type: 'api-key', headerName: 'x-api-key', queryName: '', prefix: '' }
        : id === 'gemini'
          ? { type: 'api-key', headerName: 'x-goog-api-key', queryName: '', prefix: '' }
          : { type: 'bearer', headerName: 'Authorization', queryName: '', prefix: 'Bearer ' },
    capabilities: { ...a.capabilities },
    legacyAdapterId: id,
    // 本地模型跑得慢，逾時要放寬到 5 分鐘
    timeoutSec: a.isLocal ? 300 : 90,
  };
}

/** 能出圖的引擎（生成面板的下拉選單來源） */
export function imageProviders(): ProviderAdapter[] {
  return ADAPTERS.filter((a) => a.capabilities.imageGenerate);
}

/** 能做局部重繪的引擎 */
export function inpaintProviders(): ProviderAdapter[] {
  return ADAPTERS.filter((a) => a.capabilities.imageInpaint);
}

/** 能精煉提示語的引擎 */
export function textProviders(): ProviderAdapter[] {
  return ADAPTERS.filter((a) => a.capabilities.text);
}
