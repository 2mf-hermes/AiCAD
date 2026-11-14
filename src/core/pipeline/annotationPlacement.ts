/* ============================================================================
   標註定位（Annotation Placement）
   ----------------------------------------------------------------------------
   使用者的要求：
   「標註項目的內容依然被生圖模型產生。要用文字模型的視覺判斷來決定產生圖的內容位置，
     在應用程式新增文字圖層，把文字放進圖層內加上去，不要讓生圖模型生字。」

   所以生圖完成後多跑一段「視圖模型看圖 → 回報每一行標註該擺哪」的流程：
     1. 把生出來的圖（以及標註清單）送給視圖模型；
     2. 模型只回「名稱 → 位置（0..1 比例）」的純資料，不回文字、不回 SVG；
     3. 應用程式用 resolveAnnotationPlacements 夾回安全範圍後，
        把文字畫進自己的標註圖層。

   為什麼要模型回報位置才可信：
   固定標註帶保證可讀，但永遠只能放在圖面下方一條橫帶上，尺寸箭頭指不到物件；
   視圖模型看得到物件在哪，能說出「總長 的尺寸線該壓在底視圖下方」。
   但它也會看歪，所以位置一律夾回繪圖區、並且避開標題欄與比例尺。

   失敗一律不影響出圖：定位只是疊加層的位置，拿不到就退回標註帶。
   ========================================================================== */

import { createProvider } from '../providers/provider';
import { ProviderError } from '../providers/types';
import type { ProviderConfig } from '../providers/types';
import { annotationBandHeight, annotationRows, type AnnotationPlacement } from '../annotationOverlay';
import type { SheetLayout } from '../sheetLayout';
import type { DrawingIntent } from '../types';
import { executeWithFallback, type RunDeps } from './orchestrator';

/** 模型偶爾會包 ```json，或在前面加一句話；這裡只取第一個 JSON 陣列或物件。 */
function extractJsonArray(text: string): unknown[] | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? text;
  const start = fenced.search(/[[{]/);
  if (start < 0) return null;
  for (let end = fenced.length; end > start; end -= 1) {
    const slice = fenced.slice(start, end);
    if (!/[\]}]/.test(slice.at(-1) ?? '')) continue;
    try {
      const parsed: unknown = JSON.parse(slice);
      if (Array.isArray(parsed)) return parsed;
      if (parsed && typeof parsed === 'object') {
        const list = (parsed as { placements?: unknown; items?: unknown }).placements ?? (parsed as { items?: unknown }).items;
        if (Array.isArray(list)) return list;
      }
    } catch { /* keep shrinking */ }
  }
  return null;
}

const POSITION_SYSTEM_PROMPT = [
  'You are a drafting checker reading a finished technical drawing.',
  'The drawing sheet is described as a 0..1 coordinate box: (0,0) is the top-left corner of the sheet, (1,1) is the bottom-right.',
  'You are NOT drawing anything and you are NOT writing any text. You only report where each existing annotation item should be placed.',
  'RULES',
  '- Return every annotation row you were given, using its label EXACTLY as written. Never invent new labels.',
  '- Position = the TOP-LEFT corner of that annotation row on the sheet, in 0..1 sheet coordinates.',
  '- Put each dimension line beside the view it measures, not inside solid part geometry, not over other annotations, and not over the title block in the bottom-right.',
  '- Keep roughly 0.03 of vertical spacing between rows so the text never overlaps.',
  '- If you cannot tell where an item belongs, omit it. Do not guess wildly.',
  'OUTPUT',
  'Answer with a JSON array only, no prose, no code fence required:',
  '[{"key":"<label exactly as given>","x":0.12,"y":0.34,"anchor":"start"}]',
  'anchor is optional and must be one of start, middle, end.',
].join('\n');

/**
 * 問視圖模型每一行標註該擺哪。
 * 沒有標註列、沒有文字模型、或模型回了看不懂的東西，一律回空陣列 ——
 * 呼叫端會因此退回固定標註帶，出圖結果不變，只是位置沒那麼貼近物件。
 */
export async function locateAnnotations(
  intent: DrawingIntent,
  layout: SheetLayout,
  image: { mimeType: string; base64: string },
  deps: RunDeps,
): Promise<AnnotationPlacement[]> {
  const rows = annotationRows(intent);
  if (rows.length === 0) return [];
  if (annotationBandHeight(intent) === 0) return [];
  const selected = deps.settings.activeTextProvider;
  if (selected === 'none') return [];

  const list = rows.map((row, index) => `${index + 1}. ${row.key}: ${row.value}`).join('\n');
  const subject = [
    'Finished drawing attached. Report where each annotation row belongs.',
    '',
    'ANNOTATION ROWS',
    list,
    '',
    'SHEET',
    `- Drawing area: x ${layout.drawing.x.toFixed(3)}..${(layout.drawing.x + layout.drawing.w).toFixed(3)}, y ${layout.drawing.y.toFixed(3)}..${(layout.drawing.y + layout.drawing.h).toFixed(3)} (0..1 sheet coordinates).`,
    layout.titleBlock
      ? `- Title block (keep clear): x ${layout.titleBlock.x.toFixed(3)}..${(layout.titleBlock.x + layout.titleBlock.w).toFixed(3)}, y ${layout.titleBlock.y.toFixed(3)}..${(layout.titleBlock.y + layout.titleBlock.h).toFixed(3)}.`
      : '- No title block on this sheet.',
    layout.scaleBar
      ? `- Scale bar (keep clear): x ${layout.scaleBar.x.toFixed(3)}..${(layout.scaleBar.x + layout.scaleBar.w).toFixed(3)}, y ${layout.scaleBar.y.toFixed(3)}..${(layout.scaleBar.y + layout.scaleBar.h).toFixed(3)}.`
      : '',
    '',
    'Answer with the JSON array only.',
  ].filter(Boolean).join('\n');

  try {
    const { result } = await executeWithFallback(
      /* 直接用 orchestrator 的 preferredFirst 會形成循環匯入，
         這裡的效果一樣：指定供應商排到最前面，其餘依原優先序接續。 */
      deps.settings.providers.map((config) => ({ ...config, priority: config.id === selected ? -1 : config.priority })),
      'text',
      async (config: ProviderConfig, signal: AbortSignal) => {
        const output = await createProvider(config).generate(
          {
            mode: 'text',
            input: {
              draft: 'Locate the annotation rows on the attached drawing.',
              subject,
              systemPrompt: POSITION_SYSTEM_PROMPT,
              instruction: 'Return the JSON array now, and nothing else.',
              /* 有圖就會走視圖模型（provider.ts 會用 visionModel）；這正是我們要的能力。 */
              images: [image],
            },
          },
          signal,
        );
        if (typeof output !== 'string' || !output.trim()) {
          throw new ProviderError('標註定位回應格式無效', config.id, undefined, undefined, 'invalid-response');
        }
        return output;
      },
      deps.signal,
      (config: ProviderConfig, attempt: number) =>
        deps.onProgress({ stage: 'compositing', note: `${config.name} 正在判讀標註位置${attempt > 1 ? `（重試 ${attempt - 1}）` : ''}` }),
    );

    const parsed = extractJsonArray(result);
    if (!parsed) return [];
    const placements: AnnotationPlacement[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const record = item as { key?: unknown; label?: unknown; x?: unknown; y?: unknown; anchor?: unknown };
      const key = typeof record.key === 'string' ? record.key : typeof record.label === 'string' ? record.label : '';
      const x = typeof record.x === 'number' ? record.x : Number(record.x);
      const y = typeof record.y === 'number' ? record.y : Number(record.y);
      if (!key.trim() || !Number.isFinite(x) || !Number.isFinite(y)) continue;
      /* 模型有時回百分比（0..100）而不是 0..1；超過 1.5 就當百分比換算，
         免得整個定位被夾到右下角一團。 */
      const norm = (value: number) => (Math.abs(value) > 1.5 ? value / 100 : value);
      placements.push({
        key: key.trim(),
        x: norm(x),
        y: norm(y),
        anchor: record.anchor === 'middle' || record.anchor === 'end' ? record.anchor : 'start',
      });
    }
    return placements;
  } catch {
    /* 定位失敗不是出圖失敗：靜靜退回標註帶。 */
    deps.signal.throwIfAborted();
    return [];
  }
}
