/* Generation pipeline with finite priority fallback. */
import { buildInpaintPrompt, buildNegativePrompt, buildPositivePrompt, sheetOverlayGuard } from '../prompt/builder';
import {
  buildDraftPromptRequest,
  buildDraftPromptSystemPrompt,
  buildDraftRequest,
  buildDraftSystemPrompt,
  extractDraftHtml,
  extractTextLabels,
  labelGuard,
  mergeDraftIntoPrompt,
  normalizeDraftPrompt,
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

/**
 * 從精煉後的骨架提示詞取出 Subject 行（精煉階段就是把這一行換成模型改寫的描述）。
 * 草稿階段沿用同一段描述，精煉與草稿才是同一件事的兩步，而不是兩個各自的猜測。
 */
function refinedSubjectOf(prompt: string): string | undefined {
  const line = prompt.match(/^Subject: *(.*)$/m)?.[1]?.trim();
  return line && line !== 'unspecified component' ? line : undefined;
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

async function buildDraft(intent: DrawingIntent, deps: RunDeps, refinedSubject?: string): Promise<DraftSvg | null> {
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
              subject: buildDraftRequest(intent, refinedSubject),
              /* 這一段的任務是「畫出幾何」而不是「寫出幾何描述」，
                 所以整組系統指令換掉，不沿用精煉用的規則。 */
              systemPrompt: buildDraftSystemPrompt(),
              instruction: 'Answer with the ```svg block, then the ```html block, and nothing else.',
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
    if (!svg) return null;
    return {
      svg,
      /* 同一份線稿的另一種表現：HTML 版本給模型讀結構，也讓人類看得懂。 */
      html: extractDraftHtml(result, svg),
      summary: summarizeDraft(svg),
      labels: shouldOverlayLabels(intent) ? extractTextLabels(result) : [],
    };
  } catch {
    deps.signal.throwIfAborted();
    return null;
  }
}

/* ---------------------------------------------------------------------------
   草稿 → 生圖提示詞
   ---------------------------------------------------------------------------
   生圖端點吃的是文字提示詞。草稿的價值是「版面已經定好了」，所以先讓具視圖
   能力的模型看過草稿畫面與 HTML 原始碼，把版面寫成一段純文字，再走純生成。
   這一步刻意與生成分離：翻譯拿不到結果時退回草稿幾何摘要，生成不受影響。
   --------------------------------------------------------------------------- */

interface TranslatedDraftPrompt {
  prompt: string | null;
  /** 這次翻譯用的草稿檢視圖，沿用給生圖端點，避免重新點陣化。 */
  view?: { mimeType: string; base64: string };
}

async function translateDraftToPrompt(intent: DrawingIntent, draft: DraftSvg, deps: RunDeps): Promise<TranslatedDraftPrompt> {
  const selected = deps.settings.activeTextProvider;
  if (selected === 'none') return { prompt: null };

  /* HTML 的視覺內容就是內嵌的那張 SVG：把它點陣化成模型看得懂的檢視圖，
     HTML 原始碼另外以文字形式附上。點陣化失敗（例如環境沒有 canvas）就只送
     原始碼，模型仍能從座標與結構推出版面。 */
  let view: { mimeType: string; base64: string } | undefined;
  try {
    view = await renderDraftPng(draft.svg, intent.lineStyle);
  } catch {
    view = undefined;
  }
  const references = (intent.references ?? [])
    .filter((r) => r.mimeType.startsWith('image/'))
    .map((r) => ({ mimeType: r.mimeType, base64: r.dataUrl.split(',')[1] ?? '' }));
  const images = view ? [view, ...references] : references;

  try {
    const { result } = await executeWithFallback(
      preferredFirst(deps.settings.providers, selected),
      'text',
      async (config, signal) => {
        const output = await createProvider(config).generate(
          {
            mode: 'text',
            input: {
              draft: 'Convert the draft sheet into an image-generation prompt.',
              subject: buildDraftPromptRequest(intent, draft, Boolean(view)),
              systemPrompt: buildDraftPromptSystemPrompt(),
              instruction: 'Answer with the prompt paragraph only.',
              images: images.length ? images : undefined,
            },
          },
          signal,
        );
        if (typeof output !== 'string') {
          throw new ProviderError('提示詞回應格式無效', config.id, undefined, undefined, 'invalid-response');
        }
        return output;
      },
      deps.signal,
      (config, attempt) => deps.onProgress({
        stage: 'refining',
        note: `${config.name} 正在判讀草稿並改寫生圖提示詞${attempt > 1 ? `（重試 ${attempt - 1}）` : ''}`,
      }),
    );
    /* 模型可能把草稿原封不動吐回來；那不是提示詞，寧可退回摘要。 */
    return { prompt: normalizeDraftPrompt(result) || null, view };
  } catch {
    deps.signal.throwIfAborted();
    /* 翻譯失敗仍把檢視圖帶回去：生圖端點看得到草稿版面，只是少了潤飾後的提示詞。 */
    return { prompt: null, view };
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
  /* 使用者的流程是固定的三步：文字模型先依提示詞與選項精煉提示詞 → 依精煉結果擬草稿
     → 草稿交給生圖模型。所以精煉一定要在草稿之前跑，草稿再把精煉出來的描述帶進去。
     重用上次成果時兩段都跳過：精煉過的提示詞與草稿已經存在快取裡。 */
  const resolved = reused ? { prompt: reused.basePrompt, fromModel: true } : await resolvePrompt(intent, deps);
  const basePrompt = resolved.prompt;
  deps.signal.throwIfAborted();
  // 草稿失敗就當作沒有草稿，絕不因此中斷生成。
  const draft = reused ? structuredClone(reused.draft) : await buildDraft(intent, deps, refinedSubjectOf(basePrompt));
  deps.signal.throwIfAborted();
  /* 草稿只判讀一次：翻譯出來的提示詞跟著草稿一起進快取，重試時不必再問一次模型。
     已有快取時直接沿用上次的翻譯成果 —— 這正是「沿用上次文字模型內容」的意義。 */
  const translated = draft && !reused ? await translateDraftToPrompt(intent, draft, deps) : null;
  const finalPrompt = draft ? (reused ? reused.draft?.finalPrompt ?? null : translated?.prompt ?? null) : null;
  /* 檢視圖跟著草稿一起快取：重試或「沿用上次」時生圖端點仍看得到同一張版面。 */
  const draftView = reused ? reused.draft?.view : translated?.view;
  const preparedDraft = draft ? { ...draft, finalPrompt: finalPrompt ?? undefined, view: draftView } : null;
  deps.signal.throwIfAborted();
  // Publish before image generation: errors/timeouts must not lose successful text work.
  if (resolved.fromModel) deps.onPrepared?.({ key, draft: preparedDraft, basePrompt });
  /* 翻譯成功就用它；失敗則退回「骨架＋草稿幾何摘要」，資訊較少但仍可生圖。
     兩條路都只是提示詞；版面靠下面單獨附上的草稿檢視圖表達。 */
  const textualPrompt = draft ? mergeDraftIntoPrompt(basePrompt, draft, Boolean(draftView)) : basePrompt;
  /* 改寫後的提示詞同樣不准畫字：文字一律由應用程式事後補回。 */
  const guard = draft ? labelGuard(draft.labels?.length ?? 0) : '';
  /* 改寫後的提示詞可能把「留白給圖框」那句吃掉，所以圖框疊加與不留文字兩道保險
     都要接在最後，最終送出去的提示詞一定帶得到。 */
  const prompt = finalPrompt
    ? [finalPrompt, sheetOverlayGuard(intent), guard].filter(Boolean).join('\n\n')
    : textualPrompt;
  const configs = preferredFirst(deps.settings.providers, deps.settings.activeImageProvider);
  const { width, height } = deps.settings.canvas;
  const references = (intent.references ?? [])
    .filter((r) => r.mimeType.startsWith('image/'))
    .map((r) => ({ mimeType: r.mimeType, base64: r.dataUrl.split(',')[1] ?? '' }));
  /* 草稿圖排在第一位：它是版面依據，使用者的參考圖只決定外觀。 */
  const images = draftView ? [draftView, ...references] : references;
  let referenceNotes = '';
  for (const r of intent.references ?? []) {
    if (r.mimeType !== 'text/plain') continue;
    try { referenceNotes += `\nReference file ${r.name}:\n${referenceText(r).slice(0, 4000)}\n`; } catch { /* skip unreadable */ }
  }
  const { result, config } = await executeWithFallback<ImageResult>(
    configs,
    'image',
    async (candidate, signal) => {
      const output = await createProvider(candidate).generate(
        {
          mode: 'image',
          input: {
            prompt,
            negativePrompt: buildNegativePrompt(intent),
            width,
            height,
            /* 第一張是草稿檢視圖（版面依據），其後才是使用者上傳的參考圖（外觀）。 */
            images: images.length ? images : undefined,
            referenceNotes: referenceNotes || undefined,
          },
        },
        signal,
      );
      if (typeof output === 'string') throw new ProviderError('出圖回應格式無效', candidate.id, undefined, undefined, 'invalid-response');
      return output;
    },
    deps.signal,
    (candidate, attempt) => deps.onProgress({ stage: 'drawing', note: `${candidate.name} 正在繪製圖面${attempt > 1 ? `（重試 ${attempt - 1}）` : ''}` }),
  );
  deps.signal.throwIfAborted();
  return artboard(result, intent, prompt, config, draft?.labels, draft?.svg);
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
  return { ...artboard(result, source.intent, prompt, config, source.textLabels, source.draftSvg), parentId: source.id, masks: structuredClone(masks) };
}

/** 草稿向量只為 CAD 匯出而留存；超過上限就放棄，避免專案檔被單張圖撐大。 */
const MAX_DRAFT_SVG = 24_000;

function artboard(result: ImageResult, intent: DrawingIntent, prompt: string, config: ProviderConfig, labels?: DrawingTextLabel[], draftSvg?: string): Artboard {
  return {
    id: createSafeId('result'), createdAt: Date.now(), imageRef: `data:image/png;base64,${result.base64}`,
    width: result.width, height: result.height, intent: structuredClone(intent), resolvedPrompt: prompt,
    providerId: config.id, model: config.model || config.imageModel || '(服務端預設)',
    textLabels: labels && labels.length > 0 ? labels : undefined,
    draftSvg: draftSvg && draftSvg.trim().length <= MAX_DRAFT_SVG ? draftSvg : undefined,
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
