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
/**
 * 生圖提示詞的收尾保險（給「模型改寫出來的提示詞」用）。
 *
 * 改寫過的提示詞可能整段重寫、把保留區一句話吃掉，於是模型又自己畫起圖框。
 * 這裡用一句話把「標題欄與比例尺由應用程式疊加、你只要留白」重新釘回最後。
 */
export function sheetOverlayGuard(intent: DrawingIntent): string {
  const layout = sheetLayout({
    titleBlock: intent.annotation.titleBlock,
    measurements: hasMeasurementRows(intent),
    scaleBar: intent.annotation.scaleBar,
  });
  const titleSlot = layout.titleBlock
    ?? sheetLayout({ titleBlock: true, measurements: false, scaleBar: false }).titleBlock;
  const slots: string[] = [];
  if (titleSlot) slots.push(`the title slot at ${describeRect(titleSlot)}`);
  if (layout.scaleBar) slots.push(`the scale-bar slot at ${describeRect(layout.scaleBar)}`);
  const blank = slots.length ? `Keep ${slots.join(' and ')} blank white paper. ` : '';
  return `${blank}The application draws the ISO 7200 title block and the graphic scale bar as overlay layers after generation: never draw a title block, table, cell grid, ruler graphic or lettering in those slots, and never letter the title, date or sheet text yourself.`;
}

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
  /* 標題欄一律由應用程式疊加，且不論開關都要留白：
     使用者的要求是「無論有沒有開啟標題，都按標準圖面標題位置預留空白，不要將物件繪製於此」。
     沒開標題時也留，之後才打開標題才不會壓在已經畫好的線稿上。 */
  const titleSlot = layout.titleBlock
    ?? sheetLayout({ titleBlock: true, measurements: false, scaleBar: false }).titleBlock;
  if (titleSlot) {
    lines.push(
      `Title slot: keep the rectangle at ${describeRect(titleSlot)} as completely blank paper — no title-block frame, no cells, no table, no lettering, no linework and no part of any view. The application draws the title block there as its own overlay layer after generation.`,
    );
  }
  if (layout.scaleBar) {
    lines.push(
      `Scale bar: keep the slot at ${describeRect(layout.scaleBar)} blank; the application draws the graphic scale bar there as its own overlay layer after generation.`,
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
  /* 標題欄與比例尺一律是應用程式疊上去的圖層：任何模式、任何開關都不交給模型畫，
     模型只負責把那塊留白。 */
  if (a.titleBlock)
    out.push('leave the reserved title-block rectangle completely empty as blank paper; the application renders the ISO 7200 title-block frame, cells and text as an overlay layer');
  if (a.scaleBar) out.push('leave the reserved scale-bar slot completely empty; the application renders the graphic scale bar as an overlay layer');
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

/* ---------------------------------------------------------------------------
   視角規則
   ---------------------------------------------------------------------------
   使用者要的是「不要過度增加原提示詞沒有的角度」：只有使用者自己在提示詞裡寫了視角，
   才畫那個視角；沒寫時才由我們按投影法補齊前、後、左、右、仰、俯六個視圖。
   這段同時給生圖提示與草稿指令使用，兩邊講同一套話，草稿與成品才不會各畫各的。
   ------------------------------------------------------------------------- */

/** 提示詞裡是否已經自己指定了視角（中英日韓都認）。 */
const VIEW_WORDS = /(?:\bviews?\b|\bviewpoint\b|\belevations?\b|\bplan\b|\bsection\b|\bisometric\b|\bperspective\b|\baxonometric\b|\bfront\b|\brear\b|\bback\b|\bside\b|\btop\b|\bbottom\b|\bleft\b|\bright\b|視圖|視角|正視|前視|後視|左視|右視|側視|俯視|仰視|上視|下視|立面|平面圖|剖面|等角|透視|軸測|アイソメ|正面図|平面図|측면도|투상도)/i;

export function hasExplicitViews(intent: DrawingIntent): boolean {
  return VIEW_WORDS.test(`${intent.subject} ${intent.categoryContent} ${intent.notes}`);
}

const SIX_VIEWS = 'front view, rear view, left view, right view, top view (plan) and bottom view (underside)';

/** 投影法講清楚：第一角法與第三角法差在視圖擺位，模型常常自己猜。 */
function projectionWords(intent: DrawingIntent): string {
  return intent.projection === 'first'
    ? 'first-angle projection (ISO-E: view placed on the far side of the object)'
    : 'third-angle projection (ISO-A: plan above, side views beside)';
}

/**
 * 視角指示：有指定就只畫指定的，沒指定才補齊六個標準視圖。
 * 這是「不要過度增加原提示詞沒有的角度」的實作點。
 */
export function viewDirective(intent: DrawingIntent): string {
  const projection = projectionWords(intent);
  if (hasExplicitViews(intent)) {
    return `Views: render only the viewpoints that the request itself states — do not add extra angles, extra elevations, cutaways, exploded views or a decorative isometric inset that was not asked for. Arrange the stated views per ${projection}.`;
  }
  return `Views: the request names no viewpoint, so draw exactly six orthographic views per ${projection} — ${SIX_VIEWS} — sized evenly, aligned to one another and sharing construction lines. Do not add isometric, cutaway or exploded views of your own.`;
}

export function buildPositivePrompt(intent: DrawingIntent): string {
  const parts: string[] = [
    `Professional technical drawing. ${KIND_SKELETON[intent.kind]}.`,
    `Subject: ${intent.subject.trim() || 'unspecified component'}.`,
    `Category content: ${intent.categoryContent.trim() || 'none specified'}.`,
    PROJECTION_CLAUSE[intent.projection] + '.',
    viewDirective(intent),
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

  if (intent.notes.trim()) parts.push(`Additional requirements: ${intent.notes.trim()}`);

  parts.push(reservedSheetClause(intent));
  parts.push('Sheet framing: single flat sheet, orthogonal to the viewer, no page curl.');

  return parts.join('\n');
}

/** 產出負向提示語 */
export function buildNegativePrompt(intent: DrawingIntent): string {
  // 文字由應用程式補回時，任何字形都只會是亂碼來源，明確列入負面提示。
  /* 標題欄／比例尺／修訂表一律由應用程式繪製（任何模式、任何開關都一樣），
     模型自己排的圖框只會和保留區打架，因此固定列入負面提示。 */
  const furnitureFree = ['title block', 'revision table', 'sheet number box', 'ruler graphic'];
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
  '6. Never add viewpoints, camera angles, extra elevations or exploded/cutaway views that the',
  '   user description does not already contain. Views are decided elsewhere; keep them out.',
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
