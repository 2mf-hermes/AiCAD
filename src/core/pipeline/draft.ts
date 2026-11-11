/* ============================================================================
   草稿 → SVG → 生圖
   ----------------------------------------------------------------------------
   為什麼要改生成方式：
   直接把一句需求丟給生圖模型，模型拿到的是「很多條同時成立的限制」——視角、
   線寬、投影符號、標註、留白、文字語言。它一次要猜完所有幾何，結果就是
   比例走鐘、視圖互不對齊、標註亂畫。這是擴散式生圖的本質限制：它擅長質感，
   不擅長約束求解。

   所以把工作拆成三段，各交給擅長的一方：
     1. 文字模型「擬草稿」——它會推理幾何關係，輸出可解析的 SVG 圖紙，
        同時附上一份把同一張 SVG 嵌進去的 HTML 文件（人可讀、模型也可讀）。
        視圖擺位、外形線、孔位、中心線、尺寸線與界欄都明確寫出來。
     2. 程式把 SVG 正規化成「線稿藍圖」，並把草稿畫面連同 HTML 原始碼
        交給具視圖能力的模型「看過」之後，**改寫成一段純文字生圖提示詞**。
     3. 生圖階段只送這段提示詞（外加使用者自己上傳的參考圖），走純生成端點。
        草稿本身**不再當成附圖**送出 —— 附圖等於把請求從「純生成」變成
        「帶圖編輯」，那正是生圖失敗的來源。

   這樣做的關鍵取捨（也是這支檔案主要在做的事）：
   - 文字模型的 SVG 常常有毛病（缺 viewBox、夾帶 markdown 圍籬、用了會爆版
     的巢狀 transform、塞了一堆 <text>）。**不信任模型的輸出**，一律經過
     normalizeDraftSvg：補骨架、剝樣式、移除文字、限縮尺寸。壞到救不回就
     視為失敗，退回原本的單段流程 —— 生成不能因為草稿壞掉而整個失敗。
   - 多家生圖引擎對「附圖」的語意不同：送任何附圖都可能讓請求被改走帶圖編輯流程（例如相容介面的修圖端點），
      而生圖能力不該取決於那個端點是否存在。所以草稿圖不再送出；使用者自己上傳的參考圖仍然照送（那是需求的一部分），只有「程式自己生的
     草稿」不再上車；有沒有草稿都不會改變請求的端點語義。
   - 文字模型若沒有視圖能力、或使用者沒接文字模型，就跳過草稿直接走舊路徑。
   ========================================================================== */

import type { DrawingIntent, DrawingTextLabel, LineStyle } from '../types';

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
  /** 草稿中的文字標示清單（生圖後由應用程式補回；舊呼叫端可省略） */
  labels?: DrawingTextLabel[];
  /**
   * 由草稿翻譯出來、直接送生圖端點的文字提示詞。
   * 翻譯失敗或尚未翻譯時為空，此時退回草稿幾何摘要。
   */
  finalPrompt?: string;
  /**
   * 同一張草稿的 HTML 版本：把線稿 SVG 內嵌進一份獨立文件，附上視圖名稱與
   * 幾何說明。人可以直接開來看，模型也可以讀原始碼理解「每個視圖在哪、叫什麼」。
   */
  html?: string;
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
    '6. Do NOT include <tspan>, fonts, gradients, filters, images, clip paths, or foreign objects.',
    '   <text> is allowed ONLY when the request asks for labels, and only as',
    '   <text x=".." y=".." text-anchor="start|middle|end" font-size="10-24">short label</text>.',
    '   The application strips these from the image and re-renders them in exact vector form at',
    '   the same coordinates, so place each label in clear space next to what it names, never on',
    '   top of linework, and never inside the title block (the application fills the title block).',
    '7. Do NOT use nested <g transform> chains. Keep every coordinate absolute.',
    '7b. After the SVG, append a second fenced block opened with ```html containing one complete',
    '   <!doctype html> document that embeds the same <svg> inline (no external files, no scripts)',
    '   plus a short <figcaption> per view naming the view and its scale. Do not change the geometry',
    '   between the two blocks \u2014 the HTML is the same sheet in document form.',
    '8. Stay inside the viewBox with a 40-unit margin. Never invent numbers for dimension values —',
    '   only use values explicitly supplied in the request; otherwise leave numbers out entirely.',
  ].join('\n');
}

const LABEL_LANGUAGE: Record<DrawingIntent['textLanguage'], string> = {
  'zh-Hant': 'Traditional Chinese', 'zh-Hans': 'Simplified Chinese', en: 'English',
  ja: 'Japanese', ko: 'Korean', none: 'none',
};

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
  const wantsLabels = intent.text?.renderMode !== 'image-model' && intent.textLanguage !== 'none';
  if (wantsLabels) {
    lines.push(`Labels: add up to 30 short <text> labels in ${LABEL_LANGUAGE[intent.textLanguage]} (view names, part callouts, short notes).`);
    const dims = Object.entries(intent.measurements ?? {}).filter(([k, v]) => k.trim() && v.trim());
    if (dims.length) lines.push(`Supplied dimension values (place each value beside its dimension line as a <text> label): ${dims.map(([k, v]) => `${k} = ${v}`).join('; ')}`);
  } else {
    lines.push('Labels: none. Do NOT include any <text> element.');
  }
  return `${lines.join('\n')}\n\nDraft the sheet geometry as SVG, then embed that same SVG in the HTML document.`;
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
  const labelCount = draft.labels?.length ?? 0;
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
    labelGuard(labelCount),
  ].filter((line, index) => index < 2 || line !== '').join('\n');
}

/**
 * 生圖模型不准畫字：所有文字都由應用程式事後以精確向量補回。
 * 這段要能單獨掛在「模型改寫出來的提示詞」後面，所以抽成獨立函式。
 */
export function labelGuard(count: number): string {
  return count > 0
    ? `The application will overlay ${count} exact text labels afterwards at fixed positions. Draw NO text at all: no letters, digits, characters, words, numbers, labels or glyph-like marks anywhere on the sheet, and keep the label areas of the draft clean and empty.`
    : '';
}

function decodeEntities(value: string): string {
  return value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, String.fromCharCode(34)).replace(/&#39;|&apos;/g, String.fromCharCode(39)).replace(/&amp;/g, '&');
}

/** 從原始草稿擷取 <text> 標示（正規化座標 0..1），供生圖後由應用程式按位置補回。不信任模型輸出：非有限座標、過長或空白文字一律丟棄。 */
export function extractTextLabels(raw: string, limit = 40): DrawingTextLabel[] {
  const svg = extractSvg(raw);
  if (!svg) return [];
  const labels: DrawingTextLabel[] = [];
  for (const match of svg.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/gi)) {
    const attrs = match[1] ?? '';
    const read = (name: string): string | undefined => {
      const found = attrs.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'));
      return found ? (found[1] ?? found[2] ?? '') : undefined;
    };
    const text = decodeEntities(match[2].replace(/<[^>]*>/g, '')).replace(/[\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim();
    const x = Number.parseFloat(read('x') ?? '');
    const y = Number.parseFloat(read('y') ?? '');
    if (!text || text.length > 60 || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    const anchorRaw = read('text-anchor');
    const anchor = anchorRaw === 'middle' || anchorRaw === 'end' ? anchorRaw : 'start';
    const size = Math.min(32, Math.max(8, Number.parseFloat(read('font-size') ?? '') || 14));
    const rotate = Math.min(90, Math.max(-90, Number.parseFloat((read('transform') ?? '').match(/rotate\(\s*(-?[\d.]+)/)?.[1] ?? '') || 0));
    labels.push({ text, x: Math.min(1, Math.max(0, x / SHEET_W)), y: Math.min(1, Math.max(0, y / SHEET_H)), anchor, size: size / SHEET_H, rotate });
    if (labels.length >= limit) break;
  }
  return labels;
}

function truncate(text: string, limit: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= limit ? flat : `${flat.slice(0, limit - 1)}…`;
}

/* ---------------------------------------------------------------------------
   草稿的 HTML 版本
   ---------------------------------------------------------------------------
   為什麼還要一份 HTML：SVG 是座標資料，讀得懂的人不多；HTML 版本把同一張線稿
   包成「一張有標題與說明的圖紙」，模型讀原始碼時能同時拿到「幾何座標」與
   「這張圖是什麼」。兩份都由同一份 SVG 產生，不會各說各話。
   --------------------------------------------------------------------------- */

/** 模型附上的 HTML 文件（```html 圍籬）。 */
const HTML_FENCE = /```[ \t]*html[ \t]*\r?\n([\s\S]*?)```/i;
/** HTML 只當文件看；上限只是避免壞掉的回應把記憶體吃光。 */
const HTML_LIMIT = 200_000;
/** 送去給模型讀的 HTML 原始碼長度上限。 */
const HTML_FOR_MODEL_LIMIT = 8000;

/** HTML 文件裡不准出現的東西：能執行、能連外、能蓋掉整個版面的都剔除。 */
const HTML_FORBIDDEN = /<\s*(script|iframe|frame|frameset|object|embed|applet|base|link|meta|form|input|button|textarea|select|option|video|audio|source|track|template|math|foreignObject|use)\b[\s\S]*?<\s*\/\s*\1\s*>|<\s*(script|iframe|frame|frameset|object|embed|applet|base|link|meta|form|input|button|textarea|select|option|video|audio|source|track|template|math|foreignObject|use)\b[^>]*\/?>/gi;

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 用同一份線稿 SVG 兜出一份 HTML 圖紙。
 * 模型沒給 HTML、或給的 HTML 不可用時走這條 —— 它永遠不會失敗。
 */
export function buildDraftHtmlPage(svg: string, title = 'Ai Cad construction draft'): string {
  const safeTitle = escapeHtml(title);
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    `<title>${safeTitle}</title>`,
    '<style>',
    'html,body{margin:0;padding:0;background:#fff;color:#111}',
    'body{padding:24px;font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}',
    'figure{margin:0}',
    'svg{width:100%;height:auto;display:block}',
    'figcaption{margin-top:10px;color:#444}',
    '</style>',
    '</head>',
    '<body>',
    '<figure>',
    svg.trim(),
    `<figcaption>${safeTitle}</figcaption>`,
    '</figure>',
    '</body>',
    '</html>',
  ].join('\n');
}

/**
 * 清理模型給的 HTML。**不信任模型的輸出**：能執行、能連外、能蓋版面的元素與
 * 屬性一律移除；清理後若已經不像一份文件，就回空字串讓呼叫端改用兜出來的那份。
 */
export function sanitizeDraftHtml(html: string): string {
  const raw = (html ?? '').slice(0, HTML_LIMIT).trim();
  if (!raw) return '';
  if (!/^\s*(?:<!doctype\s+html|<html[\s>])/i.test(raw)) return '';
  let out = raw.replace(HTML_FORBIDDEN, '');
  // 行內事件（onclick…）與可連外的屬性。
  out = out.replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  out = out.replace(/\s(?:href|src|xlink:href|action|formaction|poster|data)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  // CSS 的 url()/expression() 可以載入遠端資源或執行運算，直接抹掉。
  out = out.replace(/\b(?:url\s*\(|expression\s*\()/gi, '(');
  if (!/<\/html\s*>/i.test(out)) out += '\n</html>';
  return out;
}

/** 從草稿回應裡取 HTML；沒有或不可用時，用同一份 SVG 兜一份。 */
export function extractDraftHtml(raw: string, svg: string): string {
  const fenced = (raw ?? '').match(HTML_FENCE);
  const cleaned = sanitizeDraftHtml(fenced?.[1] ?? '');
  return cleaned || buildDraftHtmlPage(svg);
}

/** 給模型讀的 HTML 原始碼：去掉樣式內容（幾何與結構才是重點）再截長。 */
export function htmlForModel(html: string, limit = HTML_FOR_MODEL_LIMIT): string {
  const body = (html ?? '').replace(/<style\b[\s\S]*?<\/style\s*>/gi, '').replace(/\s+/g, ' ').trim();
  return body.length <= limit ? body : `${body.slice(0, limit - 1)}…`;
}

/* ---------------------------------------------------------------------------
   草稿 → 生圖提示詞
   ---------------------------------------------------------------------------
   生圖端點吃的是文字提示詞，所以草稿的價值必須先「翻譯」過去：讓模型看過
   草稿畫面與 HTML 之後，把版面寫成一段純文字。這一段刻意做成分離的步驟 ——
   翻譯失敗時退回草稿摘要，生成流程不受影響。
   --------------------------------------------------------------------------- */

export function buildDraftPromptSystemPrompt(): string {
  return [
    'You are an art director writing ONE image-generation prompt from a construction draft.',
    'The draft reaches you twice: as an attached render of the sheet, and as the HTML source that',
    'produced it. Read both; they describe the same sheet.',
    'Rules:',
    '1. Output the prompt text only — no heading, no bullets, no markdown, no code fences, no quotes.',
    '2. Never mention the draft, the render, the attachment, the SVG, the HTML, the model, or these rules.',
    '3. Describe the sheet: format and orientation, how many views and where each sits, what the subject',
    '   is, visible outlines, holes, symmetry, hidden or sectioned detail, dimension and centre lines,',
    '   line-weight contrast, and the empty margin around the sheet.',
    '4. Keep the proportions the draft implies. Do not invent views, parts or decorations.',
    '5. Finished illustration style: clean technical line art, monochrome, flat background.',
    '6. Write NO lettering, digits, labels or dimension values into the image — the application draws',
    '   all text afterwards. Say that the sheet is free of text instead of asking for text.',
    '7. One paragraph of 120-220 English words, comma-separated phrases where that reads better.',
  ].join('\n');
}

/** 把草稿（畫面＋HTML＋幾何摘要）壓成給翻譯模型的一次請求。 */
export function buildDraftPromptRequest(intent: DrawingIntent, draft: DraftSvg, viewAttached: boolean): string {
  const lines = [
    `Sheet subject: ${intent.subject || '(unspecified)'}`,
    `Drawing kind: ${intent.kind}`,
    `Line style target: ${intent.lineStyle}`,
    `Units: ${intent.annotation.unit}`,
  ];
  if (intent.categoryContent.trim()) lines.push(`Additional content: ${intent.categoryContent.trim()}`);
  if (intent.notes.trim()) lines.push(`Requirements: ${intent.notes.trim()}`);
  lines.push(`Text language for the sheet (do not include it in the prompt): ${intent.textLanguage}`);
  lines.push('');
  lines.push(viewAttached
    ? 'The attached image is the draft sheet rendered from the HTML below.'
    : 'No render could be attached; read the HTML below as the sheet.');
  lines.push('Draft HTML:');
  lines.push(htmlForModel(draft.html ?? buildDraftHtmlPage(draft.svg)));
  lines.push('');
  lines.push(`Geometry summary: ${draft.summary}`);
  lines.push('');
  lines.push('Write the image-generation prompt now.');
  return lines.join('\n');
}

/** 翻譯模型的回應未必乾淨：剝掉圍籬、標籤、引號，並擋掉「把草稿原封不動吐回來」。 */
export function normalizeDraftPrompt(raw: string, limit = 1600): string {
  let text = (raw ?? '').trim();
  const fenced = text.match(/```[a-z]*\s*([\s\S]*?)```/i);
  if (fenced) text = fenced[1];
  text = text.replace(/^\s*(?:image\s+generation\s+)?prompt\s*[:：]\s*/i, '');
  text = text.replace(/^\s*[「『"'“”]+/, '').replace(/[」』"'“”]+\s*$/, '');
  text = text.replace(/\s+/g, ' ').trim();
  // 回應若還是草稿本身（含標籤或座標），那不是提示詞。
  if (!text || /<\/?(?:svg|html|body|div|figure)\b/i.test(text)) return '';
  return truncate(text, limit);
}
