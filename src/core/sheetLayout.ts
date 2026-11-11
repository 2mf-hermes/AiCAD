/* ============================================================================
   圖框配置（Sheet Layout）
   ----------------------------------------------------------------------------
   為什麼要有這一層：標題欄、比例尺、尺寸列原本是「浮在圖面上」的覆蓋層，
   於是生圖內容與這些資訊互相打架 —— 標題欄蓋住視圖、尺寸文字壓在線稿上。
   解法是把「保留空白區」變成生圖前就存在的幾何約定：

     1. 生圖提示詞直接說明「下方這一條是保留區，不得有任何線稿」。
     2. 應用程式把標題欄／比例尺／尺寸列畫在同一條保留區裡。
     3. 因為保留區是固定的，使用者在生圖後才打開標題欄（或比例尺）也不會壓到圖。

   座標一律是 0..1 的正規化值（原點左上、y 向下），與圖片解析度脫鉤 ——
   1536×1024 或 2048×1365 都用同一份配置。
   ========================================================================== */

export interface SheetRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 圖框外緣留白。 */
export const SHEET_MARGIN = 0.028;
/** 保留給標題欄／比例尺／尺寸列的頁尾高度。 */
export const SHEET_FOOTER_HEIGHT = 0.178;

export interface SheetLayoutInput {
  /** 標題欄（可在生圖前後自由開關）。 */
  titleBlock: boolean;
  /** 尺寸列：有實際量測值且由應用程式繪製。 */
  measurements: boolean;
  /** 比例尺（可在生圖前後自由開關）。 */
  scaleBar: boolean;
}

export interface SheetLayout {
  /** 生圖內容必須佔用的區域；頁尾保留區不算在內。 */
  drawing: SheetRect;
  /** 圖框線；沒有保留區時為 null（整張紙就是圖面）。 */
  frame: SheetRect | null;
  /** 頁尾保留區；沒有保留區時為 null。 */
  footer: SheetRect | null;
  titleBlock: SheetRect | null;
  measurements: SheetRect | null;
  scaleBar: SheetRect | null;
}

const RIGHT = 1 - SHEET_MARGIN;
const FOOTER_TOP = RIGHT - SHEET_FOOTER_HEIGHT;
/** 頁尾內部再縮一階，讓圖框線與內容之間有呼吸空間。 */
const PAD = 0.008;

/** 依標註選項算出整張紙的分區。純函式，無狀態、可測試。 */
export function sheetLayout(input: SheetLayoutInput): SheetLayout {
  /* 只有「真的會畫東西」的註記才值得保留空白：標題欄關掉時整張紙就是圖面，
     留下空蕩的頁尾反而讓圖面變小。 */
  const reserved = input.titleBlock || input.measurements || input.scaleBar;
  const bottom = reserved ? FOOTER_TOP : RIGHT;
  const drawing: SheetRect = {
    x: SHEET_MARGIN,
    y: SHEET_MARGIN,
    w: RIGHT - SHEET_MARGIN,
    h: Math.max(0.2, bottom - SHEET_MARGIN),
  };
  if (!reserved) {
    return { drawing, frame: null, footer: null, titleBlock: null, measurements: null, scaleBar: null };
  }

  const footer: SheetRect = {
    x: SHEET_MARGIN,
    y: FOOTER_TOP,
    w: RIGHT - SHEET_MARGIN,
    h: SHEET_FOOTER_HEIGHT,
  };
  const left = SHEET_MARGIN + PAD;
  const top = FOOTER_TOP + PAD;
  const innerBottom = RIGHT - PAD;

  const titleBlock: SheetRect | null = input.titleBlock
    ? { x: 0.624, y: top, w: RIGHT - PAD - 0.624, h: innerBottom - top }
    : null;

  const leftRight = titleBlock ? 0.606 : RIGHT - PAD;
  const scaleBar: SheetRect | null = input.scaleBar
    ? { x: left, y: top + 0.004, w: Math.min(0.27, leftRight - left), h: 0.032 }
    : null;
  const measureTop = scaleBar ? top + 0.004 + 0.032 + 0.012 : top + 0.004;
  const measurements: SheetRect | null =
    input.measurements && innerBottom - measureTop > 0.02
      ? { x: left, y: measureTop, w: leftRight - left, h: innerBottom - measureTop }
      : null;

  return { drawing, frame: { x: SHEET_MARGIN, y: SHEET_MARGIN, w: RIGHT - SHEET_MARGIN, h: RIGHT - SHEET_MARGIN }, footer, titleBlock, measurements, scaleBar };
}

/** 這個區域在圖面上的位置描述（給提示詞用的英文方位語）。 */
export function describeRect(rect: SheetRect): string {
  const px = Math.round(rect.x * 100);
  const py = Math.round(rect.y * 100);
  const pw = Math.round(rect.w * 100);
  const ph = Math.round(rect.h * 100);
  const horizontal = px < 20 ? 'left edge' : px + pw > 80 ? 'right edge' : 'middle';
  const vertical = py < 20 ? 'top edge' : py + ph > 80 ? 'bottom edge' : 'middle';
  return `${px}%-${px + pw}% from the left and ${py}%-${py + ph}% from the top (${vertical} ${horizontal})`;
}
