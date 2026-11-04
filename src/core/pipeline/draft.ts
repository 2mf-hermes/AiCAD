/* ============================================================================
   草稿 → SVG → 生圖
   ----------------------------------------------------------------------------
   為什麼要改生成方式：
   直接把一句需求丟給生圖模型，模型拿到的是「很多條同時成立的限制」——視角、
   線寬、投影符號、標註、留白、文字語言。它一次要猜完所有幾何，結果就是
   比例走鐘、視圖互不對齊、標註亂畫。這是擴散式生圖的本質限制：它擅長質感，
   不擅長約束求解。

   所以把工作拆成兩段，各交給擅長的一方：
     1. 文字模型先「擬草稿」——它會推理幾何關係，輸出可解析的 SVG 圖紙：
        視圖擺位、外形線、孔位、中心線、尺寸線與界欄都明確寫出來。
     2. 程式把 SVG 正規化成「線稿藍圖」，連同精簡後的指令一起送給生圖模型
        當構圖依據。模型此時不必再發明版面，只要把既定構圖畫成成品。

   這樣做的關鍵取捨（也是這支檔案主要在做的事）：
   - 文字模型的 SVG 常常有毛病（缺 viewBox、夾帶 markdown 圍籬、用了會爆版
     的巢狀 transform、塞了一堆 <text>）。**不信任模型的輸出**，一律經過
     normalizeDraftSvg：補骨架、剝樣式、移除文字、限縮尺寸。壞到救不回就
     視為失敗，退回原本的單段流程 —— 生成不能因為草稿壞掉而整個失敗。
   - 多家生圖引擎對「附圖」的語意不同：Gemini 把它當編輯底稿，OpenAI 相容
     介面走 /images/edits。所以藍圖不是無條件塞進去，而是由引擎能力決定
     （下層 createProvider 已有分工），這裡只負責把藍圖做成 PNG。
   - 文字模型若沒有視圖能力、或使用者沒接文字模型，就跳過草稿直接走舊路徑。
   ========================================================================== */

import type { DrawingIntent, LineStyle } from '../types';

/** 草稿的長邊像素。太大會拖慢生圖，太小則線稿糊成一片。 */
const DRAFT_SIZE = 1024;
/** 送進生圖提示詞的幾何摘要上限：提示詞不是日誌，過長反而稀釋重點。 */
const SUMMARY_LIMIT = 1400;
/** 草稿圖紙的固定座標系。長寬比貼近輸出的 1536×1024，模型照抄版面才不會被拉伸。 */
const SHEET_W = 1000;
const SHEET_H = 700;

export interface DraftSvg {
  /** 正規化後的線稿藍圖（不含文字元素） */
  svg: string;
  /** 從藍圖抽出、給生圖模型看的可讀幾何摘要 */
  summary: string;
}

/* ---------------------------------------------------------------------------
   給文字模型的草稿指令
   ---------------------------------------------------------------------------
   刻意要求「只輸出 SVG」而不是「描述一下」：要拿來當構圖依據，就必須是
   可解析的座標資料。同時把不該出現的東西逐條列黑名單，因為模型的預設行為
   是補上華麗的樣式與文字，那些在工程圖上全是雜訊。
   --------------------------------------------------------------------------- */

export function buildDraftSystemPrompt(): string {
  return [
    'You are a drafting engineer producing a precise construction draft for a technical illustrator.',
    'You output SVG only — no prose, no explanations, no markdown fences.',
    'Rules:',
    '1. Return exactly one <svg> element with a viewBox of "0 0 1000 700" and width/height omitted.',
    '2. Draw with <line>, <polyline>, <polygon>, <rect>, <circle>, <ellipse>, <path> only.',
    '3. Use stroke="#000" and fill="none" everywhere. Vary stroke-width to carry line weight:',
    '   3 for visible outlines, 1.5 for dimension and leader lines, 1 for centre lines (dash-dot),',
    '   1.5 with dashes for hidden edges.',
    '4. Lay out views orthographically and keep them aligned: front view, top view directly above',
    '   or below it, right-side view beside it, plus one isometric detail inset in a corner.',
    '5. Include centre lines through holes, extension lines with arrowheads for dimensions, and a',
    '   title block rectangle in the lower right corner.',
    '6. Do NOT include any <text>, <tspan>, fonts, gradients, filters, images, clip paths, or',
    '   foreign objects. Text is rendered later by the application in exact vector form.',
    '7. Do NOT use nested <g transform> chains. Keep every coordinate absolute.',
    '8. Stay inside the viewBox with a 40-unit margin. Never invent numbers for dimension values —',
    '   left out the numeric labels entirely.',
  ].join('\n');
}

/** 把使用者的圖面意圖壓成給草稿模型的一句話。 */
export function buildDraftRequest(intent: DrawingIntent): string {
  const lines = [
    `Sheet subject: ${intent.subject || '(unspecified)'}`,
    `Drawing kind: ${intent.kind}`,
    `Line style target: ${intent.lineStyle}`,
    `Units: ${intent.annotation.unit}`,
  ];
  if (intent.categoryContent.trim()) lines.push(`Additional content: ${intent.categoryContent.trim()}`);
  if (intent.notes.trim()) lines.push(`Requirements: ${intent.notes.trim()}`);
  return `${lines.join('\n')}\n\nDraft the sheet geometry as SVG.`;
}

/* ---------------------------------------------------------------------------
   正規化：把模型的 SVG 變成可信的線稿
   --------------------------------------------------------------------------- */

/** 模型常把 SVG 包在 ``` 圍籬裡，或在前面加一句話。 */
export function extractSvg(response: string): string {
  if (!response) return '';
  const fenced = response.match(/```(?:svg|xml)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : response;
  const start = body.indexOf('<svg');
  if (start < 0) return '';
  const end = body.lastIndexOf('</svg>');
  /* 模型常常因為輸出長度上限被截斷，整份 SVG 沒有收尾標籤。
     這種草稿依然可用 —— normalizeDraftSvg 會自行補齊標籤結構，
     而截斷處的半個標籤會因為不成立而自然被忽略。 */
  return end < start ? body.slice(start) : body.slice(start, end + 6);
}

const ALLOWED_TAGS = new Set([
  'svg', 'g', 'line', 'polyline', 'polygon', 'rect', 'circle', 'ellipse', 'path',
]);

/**
 * 線稿藍圖的安全與可用性檢查。
 * 只認幾何元素：文字、濾鏡、外部參照（xlink:href、url(...)）一律移除。
 * 這不只是清理排版，也是安全邊界 —— 草稿來自第三方模型，不能讓它把
 * 遠端資源或可執行內容帶進我們的渲染流程。
 */
export function normalizeDraftSvg(raw: string): string | null {
  const svg = extractSvg(raw);
  if (!svg) return null;

  const tagRe = /<\/?([a-zA-Z][\w:-]*)([^>]*)>/g;
  /* 根元素由我們自己寫死：viewBox 之外還必須有 width/height，
     否則各家引擎對「沒有內在尺寸的 SVG」點陣化結果不一致，藍圖可能只剩一小角。 */
  const kept: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SHEET_W}" height="${SHEET_H}" viewBox="0 0 ${SHEET_W} ${SHEET_H}">`,
  ];
  const stack: string[] = ['svg'];
  let sawGeometry = false;

  for (const match of svg.matchAll(tagRe)) {
    const [whole, rawName] = match;
    const name = rawName.toLowerCase();
    const closing = whole.startsWith('</');

    if (name === 'svg') {
      // 外層 svg 的屬性（含 viewBox）由我們自己寫死，模型的尺寸設定不可信。
      continue;
    }

    // 容器內的非幾何元素連內容帶標籤整段丟掉。
    if (!ALLOWED_TAGS.has(name)) {
      if (closing && stack[stack.length - 1] === name) stack.pop();
      if (closing) continue;
      if (!whole.endsWith('/>')) stack.push(name);
      continue;
    }

    if (closing) {
      if (stack[stack.length - 1] === name) {
        stack.pop();
        kept.push(`</${name}>`);
      }
      continue;
    }

    sawGeometry = true;
    const attrs = sanitizeAttrs(match[2] ?? '');
    if (whole.endsWith('/>')) {
      kept.push(`<${name}${attrs}/>`);
    } else {
      stack.push(name);
      kept.push(`<${name}${attrs}>`);
    }
  }

  if (!sawGeometry) return null;

  // 收尾：沒關到的元素補上，否則整份 SVG 解析失敗。
  for (let i = stack.length - 1; i > 0; i -= 1) {
    if (stack[i] !== 'svg') kept.push(`</${stack[i]}>`);
  }
  kept.push('</svg>');
  return kept.join('');
}

const ALLOWED_ATTRS = new Set([
  'x1', 'y1', 'x2', 'y2', 'x', 'y', 'width', 'height', 'cx', 'cy', 'r', 'rx', 'ry',
  'points', 'd', 'stroke', 'stroke-width', 'stroke-dasharray', 'fill', 'opacity',
]);

/** 屬性白名單：不認得的全丟，尤其擋掉 href / url() 這類外部參照。 */
function sanitizeAttrs(rawAttrs: string): string {
  const out: string[] = [];
  const attrRe = /([a-zA-Z:_][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let hasStroke = false;
  let hasFill = false;
  for (const m of rawAttrs.matchAll(attrRe)) {
    const key = m[1].toLowerCase();
    const value = (m[3] ?? m[4] ?? m[5] ?? '').trim();
    if (!ALLOWED_ATTRS.has(key)) continue;
    if (/url\(|javascript:|data:/i.test(value)) continue;
    if (key === 'fill') {
      hasFill = true;
      out.push('fill="none"');
      continue;
    }
    if (key === 'stroke') {
      hasStroke = true;
      out.push('stroke="#000"');
      continue;
    }
    out.push(`${key}="${value.replace(/"/g, '')}"`);
  }
  /* 即使某個屬性被安全規則丟掉，填色與線色也一定要留下：
     少了 fill="none" 的圖形會被黑色填滿，整張草稿就毀了。 */
  if (!hasFill) out.push('fill="none"');
  if (!hasStroke) out.push('stroke="#000"');
  return ` ${out.join(' ')}`;
}

/** 從藍圖數出可讀的幾何摘要，讓生圖模型知道這張圖有什麼。 */
export function summarizeDraft(svg: string): string {
  const counts: Record<string, number> = {};
  for (const m of svg.matchAll(/<(line|polyline|polygon|rect|circle|ellipse|path)\b/g)) {
    counts[m[1]] = (counts[m[1]] ?? 0) + 1;
  }
  const parts = Object.entries(counts).map(([tag, n]) => `${n} ${tag}`);
  const rows = [...svg.matchAll(/\b(?:x2|y2|x|y|cx|cy)="(\d+(?:\.\d+)?)"/g)]
    .map((m) => Number.parseFloat(m[1]))
    .filter((n) => Number.isFinite(n));
  const span = rows.length ? Math.max(...rows) : 0;

  const detail = parts.length ? parts.join(', ') : 'no geometry';
  const extent = span > 0 ? `geometry extends to about ${Math.round(span)} on a 1000-unit sheet` : '';
  return truncate(`Construction draft: ${detail}${extent ? `; ${extent}` : ''}.`, SUMMARY_LIMIT);
}

/* ---------------------------------------------------------------------------
   藍圖 → PNG
   ---------------------------------------------------------------------------
   生圖引擎吃的是點陣參考圖，不是 SVG。這裡把線稿畫成白底黑線，並依線條風格
   反相（藍圖風＝深底白線），讓模型的參考底稿跟成品同一種視覺語言。
   --------------------------------------------------------------------------- */

export async function renderDraftPng(svg: string, style: LineStyle, size = DRAFT_SIZE): Promise<{ mimeType: string; base64: string }> {
  const dark = style === 'blueprint';
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = Math.round((size * 7) / 10);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('無法建立 2D 繪圖環境');

  ctx.fillStyle = dark ? '#0f2b46' : '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  try {
    const image = await loadImage(url);
    // 深色底要先把線稿反相，白線才會留在深底上。
    if (dark) ctx.filter = 'invert(1)';
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    ctx.filter = 'none';
  } finally {
    URL.revokeObjectURL(url);
  }

  const dataUrl = canvas.toDataURL('image/png');
  return { mimeType: 'image/png', base64: dataUrl.split(',')[1] ?? '' };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('草稿藍圖載入失敗'));
    img.src = src;
  });
}

/* ---------------------------------------------------------------------------
   把草稿接回提示詞
   ---------------------------------------------------------------------------
   做法是「追加」而不是「改寫」：buildPositivePrompt 產生的骨架（視角規則、
   線條規則、排除清單）是經過測試的，草稿只補上它不知道的部分 —— 這張圖
   實際長什麼樣。這樣任一段出錯都不會互相拖累。
   --------------------------------------------------------------------------- */

export function mergeDraftIntoPrompt(basePrompt: string, draft: DraftSvg, attached: boolean): string {
  return [
    basePrompt,
    '',
    attached
      ? 'The first attached image is an untextured construction draft. Follow its geometry, view placement and proportions.'
      : 'A construction draft was prepared for this sheet; follow it for geometry, view placement and proportions.',
    draft.summary,
    attached
      ? 'Render that layout to finished drawing quality; keep every view exactly where the draft puts it.'
      : 'Keep every view where the draft summary puts it.',
    'Do not invent extra views, do not rotate the sheet, and do not add decorations.',
    'Any further attached images are user-supplied references for appearance only, not new layouts.',
  ].join('\n');
}

function truncate(text: string, limit: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= limit ? flat : `${flat.slice(0, limit - 1)}…`;
}
