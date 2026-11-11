/* ============================================================================
   提示語建構層 (Prompt Composition)
   ----------------------------------------------------------------------------
   為什麼要有這一層：直接把使用者的一句話丟給繪圖模型，得到的是「像工程圖
   的插畫」。要得到可讀的圖面，必須把意圖編譯成有固定骨架的指令：
       視角規則 → 線條規則 → 標註規則 → 尺寸清單 → 排除清單
   骨架是純函式、可測試、可重現；模型只負責潤飾主體描述。
   ========================================================================== */

import type { DrawingIntent, DrawingKind, LineStyle, MaskRegion, Unit } from '../types';
import { describeRect, sheetLayout } from '../sheetLayout';

/** 每種圖面類型的視角與構圖骨架 */
const KIND_SKELETON: Record<DrawingKind, string> = {
  'mechanical-part':
    'orthographic multi-view engineering drawing: front, top and right-side views arranged on one sheet, plus one isometric detail inset',
  assembly:
    'assembly drawing showing mated components in correct spatial relationship, with a parts list table on the right edge',
  'floor-plan':
    'architectural floor plan, strict top-down plan view, walls in double-line poché, door swings and window openings indicated',
  elevation:
    'architectural elevation and section drawing, true-height projection, floor levels marked with datum lines',
  electrical:
    'electrical schematic using standard IEC symbols, ladder layout, nets labelled, no perspective',
  piping:
    'piping and instrumentation diagram (P&ID) with ISA instrument bubbles, line numbers and flow direction arrows',
  schematic:
    'functional block diagram, rectangular blocks connected by labelled signal paths, left-to-right signal flow',
  'exploded-view':
    'exploded isometric view, components displaced along their assembly axes with dashed alignment trails',
};

/** 線條風格 → 具體的媒材與筆觸描述 */
const LINE_STYLE_CLAUSE: Record<LineStyle, string> = {
  'technical-ink':
    'crisp uniform-weight black ink linework on white paper, visible line-weight hierarchy (0.7 mm outlines, 0.35 mm hidden lines, 0.25 mm dimension lines), no shading, no gradients',
  blueprint:
    'classic cyanotype blueprint: white linework on deep prussian-blue ground, even line weights, slight paper grain',
  'pencil-draft':
    'graphite pencil draft on off-white vellum, light construction lines left visible, restrained hatching only where a section is cut',
  'cad-vector':
    'flat vector CAD output, pure black strokes on pure white, geometric precision, zero texture, zero anti-alias blur',
};

const PROJECTION_CLAUSE = {
  first: 'first-angle projection (ISO/JIS convention), projection symbol shown in the title block',
  third: 'third-angle projection (ANSI convention), projection symbol shown in the title block',
} as const;

const UNIT_WORD: Record<Unit, string> = {
  mm: 'millimetres',
  cm: 'centimetres',
  m: 'metres',
  in: 'inches',
  ft: 'feet',
};

/** 無論使用者怎麼設定，這些都是「圖面」不該出現的東西 */
const TEXT_LANGUAGE: Record<DrawingIntent['textLanguage'], string> = {
  'zh-Hant': 'Traditional Chinese', 'zh-Hans': 'Simplified Chinese', en: 'English',
  ja: 'Japanese', ko: 'Korean', none: 'no natural-language text',
};

const BASELINE_EXCLUDE = [
  'photorealistic rendering',
  'dramatic lighting',
  'cast shadows',
  'colour gradients',
  'decorative background',
  'watermark',
  'signature',
  'lens blur',
  'depth of field',
  'illegible scribbled pseudo-text',
  'garbled text',
  'invented glyphs',
  'warped lettering',
  'misspelled labels',
];

/** 有實際量測值才算數：空的列不該佔用保留區，也不該出現在圖面上。 */
export function hasMeasurementRows(intent: DrawingIntent): boolean {
  return Object.entries(intent.measurements).some(([key, value]) => key.trim() && value.trim());
}

/**
 * 生圖前就把「這一塊要留白」講清楚。
 *
 * 為什麼不能只靠事後疊圖：模型若把視圖或線稿畫進保留區，之後疊上去的標題欄
 * 與尺寸列就會直接壓在圖面上（也就是使用者圈起來的那個問題）。所以這裡把
 * 保留區的百分比座標寫進提示詞，生圖階段就留下空白。
 */
export function reservedSheetClause(intent: DrawingIntent): string {
  const layout = sheetLayout({
    titleBlock: intent.annotation.titleBlock,
    measurements: hasMeasurementRows(intent),
    scaleBar: intent.annotation.scaleBar,
  });
  const lines = [
    `Sheet division: every view, section, dimension line, leader and hatch must stay strictly inside the drawing area at ${describeRect(layout.drawing)}.`,
  ];
  if (layout.footer) {
    lines.push(
      `Reserved band: keep the band at ${describeRect(layout.footer)} as completely blank white paper — no linework, no partial views, no border decoration, no lettering and no shading inside it.`,
    );
  }
  if (layout.titleBlock) {
    lines.push(
      intent.text.renderMode === 'image-model'
        ? `Title block: draw exactly one ISO 7200 title block in the bottom-right corner at ${describeRect(layout.titleBlock)}, with clean ISO 7200 lettering and no other table, revision strip or sheet-number box; the application does not draw it in this mode.`
        : `Title block: the application draws an ISO 7200 title block at ${describeRect(layout.titleBlock)} after generation, so leave that rectangle empty as blank title-block geometry and do not draw the title-block frame, cells or text yourself.`,
    );
  } else {
    lines.push(
      'Title block: this sheet has no title block. Do not draw a title block, title box, revision table, sheet-number box or any text table anywhere on the sheet.',
    );
  }
  if (layout.scaleBar) {
    lines.push(
      `Scale bar: the application draws the graphic scale bar at ${describeRect(layout.scaleBar)} after generation; leave that area empty.`,
    );
  } else {
    lines.push('Scale bar: do not draw a graphic scale bar or any ruler graphic.');
  }
  lines.push(
    'Overlap guard: nothing may be drawn on top of another element — dimension geometry must sit clear of the geometry it measures and no annotation may cover a view.',
  );
  return lines.join(' ');
}

function annotationClauses(intent: DrawingIntent): string[] {
  const a = intent.annotation;
  const out: string[] = [];
  if (a.dimensions) {
    out.push(intent.text.renderMode === 'image-model'
      ? `complete dimension geometry with extension lines, dimension lines, solid arrowheads and clearly rendered numeric values in ${UNIT_WORD[a.unit]} (${a.unit})`
      : `complete dimension geometry: extension lines and dimension lines with solid arrowheads; reserve clear gaps for application-rendered numeric values in ${UNIT_WORD[a.unit]} (${a.unit}), but do not draw the values`);
  }
  if (a.tolerance) out.push('reserve clear tolerance annotation space next to critical dimensions; do not draw tolerance text or numbers');
  if (a.gdt) out.push('GD&T feature control frames with datum references (flatness, concentricity, perpendicularity)');
  if (a.callouts) out.push('blank balloon callout geometry with straight leader lines terminating in a dot; do not draw balloon numbers');
  /* 標題欄與比例尺一律由應用程式畫在保留區：即使使用者選「文字由模型產生」，
     也不讓模型自己排版圖框，否則生圖後才開關標註項目就會壓到既有線稿。 */
  if (a.titleBlock)
    out.push(intent.text.renderMode === 'image-model'
      ? 'one ISO 7200 title block in the bottom-right corner with clean lettering; no revision strip, sheet-number box or extra table'
      : 'leave the reserved title-block rectangle completely empty as blank title-block geometry; the application renders the ISO 7200 title-block frame, cells and text');
  if (a.scaleBar) out.push('leave the reserved scale-bar slot completely empty; the application renders the graphic scale bar');
  return out;
}

function measurementBlock(intent: DrawingIntent): string {
  const rows = Object.entries(intent.measurements).filter(([k, v]) => k.trim() && v.trim());
  if (rows.length === 0) return '';
  const payload = rows.map(([k, v]) => `  - ${k}: ${v}`).join('\n');
  if (intent.text.renderMode === 'image-model') {
    return `Dimension values that must be rendered clearly and exactly in the image:\n${payload}`;
  }
  return `Dimensions supplied to the application overlay. Reserve clear annotation space and keep the geometry consistent with these values, but DO NOT rasterize these strings into the image; the application will render them exactly:\n${payload}`;
}

/**
 * image-model 模式下的標題欄文字：其餘模式由應用程式精確繪製，
 * 只有這個模式要把標題、日期與自訂欄位原文交給模型，
 * 否則使用者填的內容永遠不會出現在圖上。
 */
function titleBlockTextBlock(intent: DrawingIntent): string {
  if (intent.text.renderMode !== 'image-model' || !intent.annotation.titleBlock) return '';
  const rows: string[] = [];
  const title = intent.text.title.trim();
  const date = intent.text.date.trim();
  if (title) rows.push(`  - Title: ${title}`);
  if (date) rows.push(`  - Date: ${date}`);
  for (const field of intent.text.customFields) {
    const key = field.key.trim();
    const value = field.value.trim();
    if (key && value) rows.push(`  - ${key}: ${value}`);
  }
  if (rows.length === 0) return '';
  return `Render all requested technical titles and title-block strings letter by letter inside the title block with clean ISO 7200 engineering lettering:\n${rows.join('\n')}`;
}

export function buildPositivePrompt(intent: DrawingIntent): string {
  const parts: string[] = [
    `Professional technical drawing. ${KIND_SKELETON[intent.kind]}.`,
    `Subject: ${intent.subject.trim() || 'unspecified component'}.`,
    `Category content: ${intent.categoryContent.trim() || 'none specified'}.`,
    PROJECTION_CLAUSE[intent.projection] + '.',
    LINE_STYLE_CLAUSE[intent.lineStyle] + '.',
    intent.textLanguage === 'none'
      ? 'Sheet text: do not render natural-language labels. Leave label and annotation areas clean for the application overlay; use only essential geometry and standard engineering symbols.'
      : intent.text.renderMode === 'image-model'
        ? `Sheet text language: ${TEXT_LANGUAGE[intent.textLanguage]}. Render the drawing-area labels, notes, callouts, dimension values and the title-block strings directly in the image with clean, legible engineering lettering; letter them exactly as given, never as pseudo-text.`
        : `Sheet text language: ${TEXT_LANGUAGE[intent.textLanguage]}. Do NOT rasterize titles, labels, notes, callouts, dimension values, or other natural-language text into the generated image. Leave clean unobstructed spaces for the application to render exact vector-like text overlays. Preserve only geometry, dimension/leader line geometry, arrowheads, and standard engineering symbols. Never invent pseudo-text, placeholder glyphs, warped letters, blurred lettering, or decorative lettering.`,
  ];

  const ann = annotationClauses(intent);
  if (ann.length) parts.push(`Annotation requirements: ${ann.join('; ')}.`);

  const dims = measurementBlock(intent);
  if (dims) parts.push(dims);

  /* 標題欄原文只在 image-model 模式交給模型；其餘模式由應用程式繪製。 */
  const titleText = titleBlockTextBlock(intent);
  if (titleText) parts.push(titleText);

  if (intent.notes.trim()) parts.push(`Additional requirements: ${intent.notes.trim()}`);

  parts.push(reservedSheetClause(intent));
  parts.push('Sheet framing: single flat sheet, orthogonal to the viewer, no page curl.');

  return parts.join('\n');
}

/** 產出負向提示語 */
export function buildNegativePrompt(intent: DrawingIntent): string {
  // 文字由應用程式補回時，任何字形都只會是亂碼來源，明確列入負面提示。
  /* 標題欄／比例尺／修訂表一律由應用程式繪製，任何模型自己排的圖框都只會
     和保留區打架，因此固定列入負面提示。 */
  /* 例外：image-model 模式下標題欄就是模型要畫的那一格，負面提示不能同時禁止它，
     否則正負面提示互相打架，模型往往就整張不畫或亂畫。 */
  const modelDrawsTitleBlock = intent.text.renderMode === 'image-model' && intent.annotation.titleBlock;
  const furnitureFree = modelDrawsTitleBlock
    ? ['extra tables', 'revision table', 'sheet number box', 'ruler graphic']
    : ['title block', 'revision table', 'sheet number box', 'ruler graphic'];
  const textFree = intent.text.renderMode === 'image-model' ? [] : ['any text', 'letters', 'numbers', 'words', 'characters', 'labels', 'typography'];
  return [...BASELINE_EXCLUDE, ...furnitureFree, ...textFree, ...intent.exclude.filter((s) => s.trim())].join(', ');
}

/** 局部重繪：只描述選區內要發生的變化，並鎖住其餘部分 */
export function buildInpaintPrompt(intent: DrawingIntent, mask: MaskRegion): string {
  return [
    'Edit only the masked region of this existing technical drawing.',
    `Change requested inside the mask: ${mask.instruction.trim() || 'add missing detail'}.`,
    `Match the surrounding drawing exactly: ${LINE_STYLE_CLAUSE[intent.lineStyle]}.`,
    intent.text.renderMode === 'image-model'
      ? `Sheet text language: ${TEXT_LANGUAGE[intent.textLanguage]}. Render requested titles, labels, notes, callouts and dimension values directly in the edited image using clean technical lettering.`
      : `Sheet text language: ${TEXT_LANGUAGE[intent.textLanguage]}. Do NOT rasterize new titles, labels, notes, callouts, dimension values, or other natural-language text into the edited image. Leave clean unobstructed annotation space for the application to render exact vector-like text overlays. Preserve only required geometry, dimension/leader line geometry, arrowheads, and standard engineering symbols. Never generate pseudo-text, invented glyphs, garbled text, warped lettering or decorative lettering.`, 
    'Keep line weights, lettering style, dimension arrowhead style and sheet scale identical to the unmasked area.',
    'Do not redraw, shift or restyle anything outside the mask. Do not change the title block.',
  ].join('\n');
}

/** 給文字模型的精煉指令 —— 只允許它改寫主體描述，不准動骨架 */
export const REFINE_SYSTEM_PROMPT = [
  'You are a drafting engineer who converts vague part descriptions into precise, unambiguous',
  'geometry descriptions for a technical illustrator.',
  'Rules:',
  '1. Output one concise geometry paragraph in English, under 120 words. This internal geometry',
  '   description must not change the requested language for labels on the final drawing.',
  '2. Describe geometry, features and their spatial relationships (holes, fillets, ribs, bosses,',
  '   wall thickness, mating faces). Be concrete about counts and placement.',
  '3. Never invent dimension values. If a value is unknown, describe the feature without a number.',
  '4. Never mention rendering, lighting, style, mood or camera. Geometry only.',
  '5. Return the paragraph with no preamble, no bullet points, no quotes.',
].join('\n');

/** 呼叫端可以帶入的系統指令覆寫（結構型別，避免與 provider 層互相依賴）。 */
export interface PromptInstructionInput {
  systemPrompt?: string;
  instruction?: string;
}

/**
 * 決定這一輪送給文字模型的系統指令。
 * 未覆寫時沿用精煉用的固定指令，因此既有行為完全不變；
 * 草稿階段則傳入自己的指令，不必改動各引擎的請求組裝邏輯。
 */
export function systemInstructionFor(input: PromptInstructionInput): string {
  const base = input.systemPrompt?.trim() || REFINE_SYSTEM_PROMPT;
  const extra = input.instruction?.trim();
  return extra ? `${base}\n\n${extra}` : base;
}
