/* Generation pipeline with finite priority fallback. */
import { buildInpaintPrompt, buildNegativePrompt, buildPositivePrompt } from '../prompt/builder';
import {
  buildDraftRequest,
  buildDraftSystemPrompt,
  extractTextLabels,
  mergeDraftIntoPrompt,
  normalizeDraftSvg,
  renderDraftPng,
  summarizeDraft,
  type DraftSvg,
} from './draft';
import { createProvider } from '../providers/provider';
import { referenceText } from '../references';
import {
  ProviderError,
  isRetryableProviderError,
  type ImageResult,
  type ProviderConfig,
  type ProviderMode,
  type ProviderRequest,
} from '../providers/types';
import type { Settings } from '../settings';
import type { Artboard, DrawingIntent, DrawingTextLabel, MaskRegion } from '../types';
import { createSafeId } from '../projectSafety';
import { shouldOverlayLabels } from '../textOverlay';
import { generationKey, type PreparedGeneration } from './draftCache';

export interface RunProgress {
  stage: 'drafting' | 'refining' | 'drawing' | 'compositing';
  note: string;
}

interface RunDeps {
  settings: Settings;
  onProgress: (progress: RunProgress) => void;
  signal: AbortSignal;
  onPrepared?: (prepared: PreparedGeneration) => void;
}

export interface ProviderAttempt {
  providerId: string;
  providerName: string;
  attempt: number;
  error: ProviderError;
}

export class ProviderFallbackError extends Error {
  constructor(readonly attempts: ProviderAttempt[]) {
    const summary = attempts.map((item) => `${item.providerName}: ${item.error.message}`).join('；');
    super(summary || '沒有可用的 Provider');
    this.name = 'ProviderFallbackError';
  }
}

export async function executeWithFallback<T>(
  configs: ProviderConfig[],
  mode: ProviderMode,
  run: (config: ProviderConfig, signal: AbortSignal) => Promise<T>,
  signal: AbortSignal,
  onAttempt?: (config: ProviderConfig, attempt: number) => void,
  wait: (attempt: number, signal: AbortSignal) => Promise<void> = retryDelay,
): Promise<{ result: T; config: ProviderConfig }> {
  const candidates = configs
    .filter((config) => config.enabled && supports(config, mode))
    .sort((a, b) => a.priority - b.priority)
    .filter((config, index) => index === 0 || (config.fallbackEnabled && (mode === 'text' ? config.textFallbackEnabled : config.imageFallbackEnabled)));
  const attempts: ProviderAttempt[] = [];

  for (const config of candidates) {
    const maxAttempts = Math.max(1, Math.min(6, config.retryCount + 1));
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError');
      onAttempt?.(config, attempt);
      try {
        return { result: await run(config, signal), config };
      } catch (error) {
        const normalized = normalizeError(error, config.id);
        attempts.push({ providerId: config.id, providerName: config.name, attempt, error: normalized });
        if (normalized.kind === 'cancelled') throw normalized;
        if (!isRetryableProviderError(normalized) || attempt >= maxAttempts) break;
        await wait(attempt, signal);
      }
    }
  }
  throw new ProviderFallbackError(attempts);
}

async function resolvePrompt(intent: DrawingIntent, deps: RunDeps): Promise<{ prompt: string; fromModel: boolean }> {
  const draft = buildPositivePrompt(intent);
  const selected = deps.settings.activeTextProvider;
  const refs = intent.references ?? [];
  const images = refs
    .filter((r) => r.mimeType.startsWith('image/'))
    .map((r) => ({ mimeType: r.mimeType, base64: r.dataUrl.split(',')[1] ?? '' }));
  const textRefs = refs.filter((r) => r.mimeType === 'text/plain');
  let textNotes = '';
  for (const r of textRefs) {
    try { textNotes += `\nReference file ${r.name}:\n${referenceText(r).slice(0, 4000)}\n`; } catch { /* skip unreadable */ }
  }
  const subject = `${intent.subject}\nCategory content: ${intent.categoryContent}${textNotes ? `\n${textNotes}` : ''}`;
  if (selected === 'none') return { prompt: draft, fromModel: false };
  const eligible = preferredFirst(deps.settings.providers, selected);
  try {
    const { result } = await executeWithFallback(
      eligible,
      'text',
      async (config, signal) => {
        const output = await createProvider(config).generate(
          { mode: 'text', input: { draft, subject, textLanguage: intent.textLanguage, images: images.length ? images : undefined } },
          signal,
        );
        if (typeof output !== 'string' || !output.trim()) throw new ProviderError('精煉回應格式無效', config.id, undefined, undefined, 'invalid-response');
        return output;
      },
      deps.signal,
      (config, attempt) => deps.onProgress({ stage: 'refining', note: `${config.name} 正在精煉幾何描述${attempt > 1 ? `（重試 ${attempt - 1}）` : ''}` }),
    );
    return { prompt: draft.replace(/^Subject: .*$/m, `Subject: ${result.replace(/\s+/g, ' ').trim()}`), fromModel: true };
  } catch {
    deps.signal.throwIfAborted();
    return { prompt: draft, fromModel: false };
  }
}

/* ---------------------------------------------------------------------------
   草稿階段：文字模型先擬出可解析的 SVG 圖紙
   ---------------------------------------------------------------------------
   這一段刻意做成「允許失敗」：任何例外、非 SVG 回應、救不回來的標記，
   一律回傳 null，讓生成退回原本的單段流程。生成失敗的代價遠大於草稿品質，
   寧可少一張草稿，也不要讓整個流程掛掉。
   --------------------------------------------------------------------------- */

async function buildDraft(intent: DrawingIntent, deps: RunDeps): Promise<DraftSvg | null> {
  const selected = deps.settings.activeTextProvider;
  if (selected === 'none') return null;

  const images = (intent.references ?? [])
    .filter((r) => r.mimeType.startsWith('image/'))
    .map((r) => ({ mimeType: r.mimeType, base64: r.dataUrl.split(',')[1] ?? '' }));

  try {
    const { result } = await executeWithFallback(
      preferredFirst(deps.settings.providers, selected),
      'text',
      async (config, signal) => {
        const output = await createProvider(config).generate(
          {
            mode: 'text',
            input: {
              draft: 'Produce the SVG construction draft now.',
              subject: buildDraftRequest(intent),
              /* 這一段的任務是「畫出幾何」而不是「寫出幾何描述」，
                 所以整組系統指令換掉，不沿用精煉用的規則。 */
              systemPrompt: buildDraftSystemPrompt(),
              instruction: 'Answer with the raw <svg> element and nothing else.',
              images: images.length ? images : undefined,
            },
          },
          signal,
        );
        if (typeof output !== 'string') {
          throw new ProviderError('草稿回應格式無效', config.id, undefined, undefined, 'invalid-response');
        }
        return output;
      },
      deps.signal,
      (config, attempt) => deps.onProgress({
        stage: 'drafting',
        note: `${config.name} 正在擬定圖面草稿${attempt > 1 ? `（重試 ${attempt - 1}）` : ''}`,
      }),
    );
    const svg = normalizeDraftSvg(result);
    return svg ? { svg, summary: summarizeDraft(svg), labels: shouldOverlayLabels(intent) ? extractTextLabels(result) : [] } : null;
  } catch {
    deps.signal.throwIfAborted();
    return null;
  }
}

/** 藍圖點陣化失敗（例如環境沒有 canvas）不該毀掉一次生成，只是沒有附圖可用。 */
async function tryRenderDraft(
  draft: DraftSvg,
  intent: DrawingIntent,
): Promise<{ mimeType: string; base64: string } | undefined> {
  try {
    return await renderDraftPng(draft.svg, intent.lineStyle);
  } catch {
    return undefined;
  }
}

export async function generate(intent: DrawingIntent, deps: RunDeps, options: { reuse?: PreparedGeneration } = {}): Promise<Artboard> {
  deps.signal.throwIfAborted();
  // Freeze the request so edits made during generation cannot change its meaning.
  intent = structuredClone(intent);
  const key = generationKey(intent, deps.settings.canvas);
  const reused = options.reuse;
  if (reused && reused.key !== key) {
    throw new ProviderError('圖面內容已變更，請全部重新產生', 'pipeline', undefined, undefined, 'configuration');
  }
  // 先讓文字模型擬草稿；失敗就當作沒有草稿，絕不因此中斷生成。
  const draft = reused ? structuredClone(reused.draft) : await buildDraft(intent, deps);
  /* 草稿成功時就不再跑一次「精煉主體描述」：草稿已經把實際幾何、視圖擺位寫成座標，
     比一段文字描述資訊量更高，再叫一次文字模型只是多一次延遲與費用。
     草稿失敗時才走原本的精煉路徑，維持既有行為不變。 */
  const resolved = reused ? { prompt: reused.basePrompt, fromModel: true }
    : draft ? { prompt: buildPositivePrompt(intent), fromModel: true }
    : await resolvePrompt(intent, deps);
  const basePrompt = resolved.prompt;
  deps.signal.throwIfAborted();
  // Publish before image generation: errors/timeouts must not lose successful text work.
  if (resolved.fromModel) deps.onPrepared?.({ key, draft, basePrompt });
  const draftImage = draft ? await tryRenderDraft(draft, intent) : undefined;
  // 兩種版本並存：能不能附圖要等抽到實際引擎才知道，但兩個字串都得先備好。
  const textualPrompt = draft ? mergeDraftIntoPrompt(basePrompt, draft, false) : basePrompt;
  const prompt = draftImage && draft ? mergeDraftIntoPrompt(basePrompt, draft, true) : textualPrompt;
  const configs = preferredFirst(deps.settings.providers, deps.settings.activeImageProvider);
  const { width, height } = deps.settings.canvas;
  const images = (intent.references ?? [])
    .filter((r) => r.mimeType.startsWith('image/'))
    .map((r) => ({ mimeType: r.mimeType, base64: r.dataUrl.split(',')[1] ?? '' }));
  // 草稿排在使用者參考圖之前：模型會把「第一張圖」當成版面依據。
  const sheetImages = draftImage ? [draftImage, ...images] : images;
  let referenceNotes = '';
  for (const r of intent.references ?? []) {
    if (r.mimeType !== 'text/plain') continue;
    try { referenceNotes += `\nReference file ${r.name}:\n${referenceText(r).slice(0, 4000)}\n`; } catch { /* skip unreadable */ }
  }
  let usedPrompt = textualPrompt;
  const { result, config } = await executeWithFallback<ImageResult>(
    configs,
    'image',
    async (candidate, signal) => {
      /* 附上草稿藍圖等於把請求從「純生成」變成「帶圖編輯」：OpenAI 相容介面會因此
         改走 /images/edits。沒有局部重繪能力的引擎未必實作該端點，硬附圖會讓原本
         可用的設定直接失效，所以只對有能力處理輸入影像的引擎附圖，其餘仍吃草稿摘要。 */
      const attachDraft = Boolean(draftImage) && candidate.capabilities.imageInpaint;

      const runImage = (withDraft: boolean) => createProvider(candidate).generate(
        {
          mode: 'image',
          input: {
            prompt: withDraft ? prompt : textualPrompt,
            negativePrompt: buildNegativePrompt(intent),
            width,
            height,
            images: withDraft ? sheetImages : images.length ? images : undefined,
            referenceNotes: referenceNotes || undefined,
          },
        },
        signal,
      );
      let output;
      usedPrompt = attachDraft ? prompt : textualPrompt;
      try {
        output = await runImage(attachDraft);
      } catch (error) {
        signal.throwIfAborted();
        // Only discard our optional blueprint, never user reference images.
        // A rejected edit endpoint is safe to retry as text-to-image; timeouts are not.
        const unsupported = error instanceof ProviderError && (
          [404, 405, 415, 501].includes(error.status ?? 0)
          || (error.status === 400 && /(?:not support|unsupported|not available).*(?:edit|image input)|(?:edit|image input).*(?:not support|unsupported|not available)/i.test(error.message))
        );
        if (!attachDraft || images.length || !unsupported) throw error;
        deps.onProgress({ stage: 'drawing', note: `${candidate.name} 不支援草稿圖片輸入，改用草稿文字摘要生圖` });
        usedPrompt = textualPrompt;
        output = await runImage(false);
      }
      if (typeof output === 'string') throw new ProviderError('出圖回應格式無效', candidate.id, undefined, undefined, 'invalid-response');
      return output;
    },
    deps.signal,
    (candidate, attempt) => deps.onProgress({ stage: 'drawing', note: `${candidate.name} 正在繪製圖面${attempt > 1 ? `（重試 ${attempt - 1}）` : ''}` }),
  );
  deps.signal.throwIfAborted();
  return artboard(result, intent, usedPrompt, config, draft?.labels);
}

export async function inpaint(source: Artboard, masks: MaskRegion[], deps: RunDeps): Promise<Artboard> {
  if (masks.length === 0) throw new ProviderError('尚未框選任何區域', 'pipeline', undefined, undefined, 'configuration');
  deps.onProgress({ stage: 'compositing', note: '正在合成遮罩' });
  const maskBase64 = await renderMask(masks, source.width, source.height);
  const imageBase64 = source.imageRef.replace(/^data:image\/\w+;base64,/, '');
  const prompt = masks.map((mask, index) => `${index + 1}. ${buildInpaintPrompt(source.intent, mask)}`).join('\n\n');
  const configs = preferredFirst(deps.settings.providers, deps.settings.activeImageProvider);
  const { result, config } = await executeWithFallback<ImageResult>(
    configs,
    'inpaint',
    async (candidate, signal) => {
      const request: ProviderRequest = {
        mode: 'inpaint',
        input: { prompt, negativePrompt: buildNegativePrompt(source.intent), width: source.width, height: source.height, imageBase64, maskBase64, denoise: 0.72 },
      };
      const output = await createProvider(candidate).generate(request, signal);
      if (typeof output === 'string') throw new ProviderError('重繪回應格式無效', candidate.id, undefined, undefined, 'invalid-response');
      return output;
    },
    deps.signal,
    (candidate, attempt) => deps.onProgress({ stage: 'drawing', note: `${candidate.name} 正在重繪選區${attempt > 1 ? `（重試 ${attempt - 1}）` : ''}` }),
  );
  /* 標示從未被畫進底圖，所以重繪不會毀掉或重複它們；沿用來源標示即可，使用者看到的文字維持不變。 */
  return { ...artboard(result, source.intent, prompt, config, source.textLabels), parentId: source.id, masks: structuredClone(masks) };
}

function artboard(result: ImageResult, intent: DrawingIntent, prompt: string, config: ProviderConfig, labels?: DrawingTextLabel[]): Artboard {
  return {
    id: createSafeId('result'), createdAt: Date.now(), imageRef: `data:image/png;base64,${result.base64}`,
    width: result.width, height: result.height, intent: structuredClone(intent), resolvedPrompt: prompt,
    providerId: config.id, model: config.model || config.imageModel || '(服務端預設)',
    textLabels: labels && labels.length > 0 ? labels : undefined,
  };
}

function preferredFirst(configs: ProviderConfig[], id: string): ProviderConfig[] {
  return configs.map((config) => ({ ...config, priority: config.id === id ? -1 : config.priority }));
}

function supports(config: ProviderConfig, mode: ProviderMode): boolean {
  return mode === 'text' ? config.capabilities.text : mode === 'image' ? config.capabilities.imageGenerate : config.capabilities.imageInpaint;
}

function normalizeError(error: unknown, providerId: string): ProviderError {
  if (error instanceof ProviderError) return error.providerId === providerId ? error : new ProviderError(error.message, providerId, error.status, error.hint, error.kind);
  const status = (error as { status?: number })?.status;
  return new ProviderError(error instanceof Error ? error.message : String(error), providerId, status);
}

async function retryDelay(attempt: number, signal: AbortSignal): Promise<void> {
  const delay = Math.min(2_000, 250 * 2 ** (attempt - 1));
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, delay);
    signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
  });
}

async function renderMask(masks: MaskRegion[], width: number, height: number): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('無法建立 2D 繪圖環境');
  context.fillStyle = '#000'; context.fillRect(0, 0, width, height); context.fillStyle = '#fff';
  for (const mask of masks) context.fillRect(Math.round(mask.x * width), Math.round(mask.y * height), Math.round(mask.w * width), Math.round(mask.h * height));
  return canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
}
