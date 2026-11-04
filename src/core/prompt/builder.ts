/* ============================================================================
   提示語建構層 (Prompt Composition)
   ----------------------------------------------------------------------------
   為什麼要有這一層：直接把使用者的一句話丟給繪圖模型，得到的是「像工程圖
   的插畫」。要得到可讀的圖面，必須把意圖編譯成有固定骨架的指令：
       視角規則 → 線條規則 → 標註規則 → 尺寸清單 → 排除清單
   骨架是純函式、可測試、可重現；模型只負責潤飾主體描述。
   ========================================================================== */

import type { DrawingIntent, DrawingKind, LineStyle, MaskRegion, Unit } from '../types';

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
  if (a.titleBlock)
    out.push(intent.text.renderMode === 'image-model'
      ? 'ISO 7200 style title-block geometry in the lower-right corner, with clean legible technical lettering'
      : 'ISO 7200 style blank title-block geometry in the lower-right corner; reserve clean cells and do not draw title, date, custom fields, scale, unit or sheet-number text');
  if (a.scaleBar) out.push('graphic scale bar along the lower edge');
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

/** 產出正向提示語（送給繪圖模型的主體） */
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
        ? `Sheet text language: ${TEXT_LANGUAGE[intent.textLanguage]}. Render all requested technical titles, labels, notes, callouts and dimension values directly in the image with clean, legible engineering lettering. Title: ${intent.text.title || 'unspecified'}. Date: ${intent.text.date || 'unspecified'}. Custom title-block fields: ${intent.text.customFields.filter((field) => field.key.trim() || field.value.trim()).map((field) => `${field.key}: ${field.value}`).join('; ') || 'none'}.`
        : `Sheet text language: ${TEXT_LANGUAGE[intent.textLanguage]}. Do NOT rasterize titles, labels, notes, callouts, dimension values, or other natural-language text into the generated image. Leave clean unobstructed spaces for the application to render exact vector-like text overlays. Preserve only geometry, dimension/leader line geometry, arrowheads, and standard engineering symbols. Never invent pseudo-text, placeholder glyphs, warped letters, blurred lettering, or decorative lettering.`,
  ];

  const ann = annotationClauses(intent);
  if (ann.length) parts.push(`Annotation requirements: ${ann.join('; ')}.`);

  const dims = measurementBlock(intent);
  if (dims) parts.push(dims);

  if (intent.notes.trim()) parts.push(`Additional requirements: ${intent.notes.trim()}`);

  parts.push(
    'Sheet framing: single flat sheet, orthogonal to the viewer, generous white margins, no page curl.',
  );

  return parts.join('\n');
}

/** 產出負向提示語 */
export function buildNegativePrompt(intent: DrawingIntent): string {
  return [...BASELINE_EXCLUDE, ...intent.exclude.filter((s) => s.trim())].join(', ');
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
