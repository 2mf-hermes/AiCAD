/* ============================================================================
   標註圖層（Annotation Overlay）
   ----------------------------------------------------------------------------
   為什麼要有這一層：
   「應用程式精確疊加」以前的實作只補回草稿裡的文字標示（textLabels）。
   文字有了，尺寸線、箭頭、公差註記、幾何公差框與引線卻還留在生圖模型畫的
   那一份裡 —— 於是同一個標註一半是程式畫的、一半是模型猜的，位置對不上。

   使用者的要求是：生圖完成後，由應用程式把標註項目精確疊加回去。做法沿用
   標題欄／比例尺那一套：生圖前先在圖面上「保留一條標註帶」，提示詞要求模型
   不得在裡面畫任何線稿；生圖後程式把標註帶疊上去。

   為什麼放在帶狀區域而不是貼著每個視圖：
   疊加層沒有真實的幾何座標（模型生出來的圖不是向量資料），硬把箭頭貼到
   猜測的位置只會壓在線稿上。集中成一條標註帶，位置由程式決定、永遠可讀。

   座標單位是「圖面單位」：viewBox = 1000 × viewHeight，與圖框內容一致。
   兩個地方共用同一份圖元：
     - 畫布預覽（src/ui/AnnotationLayer.tsx）
     - 匯出合成（src/core/sheetSvg.ts，再光柵化或轉 DXF）
   ========================================================================== */

import { SHEET_VIEW_WIDTH, estimateTextWidth } from './sheetFurniture';
import type { SheetLayout, SheetRect } from './sheetLayout';
import type { DrawingIntent } from './types';

/** 標註帶的高度：每一列的固定高度與上下留白（單位是紙張高度比例）。 */
const ROW_HEIGHT = 0.026;
const BAND_PADDING = 0.014;
const BAND_MIN = 0.058;
const BAND_MAX = 0.236;

/**
 * 一列量測值該算哪一種標註。
 * 判別完全看使用者填的「名稱」：填「公差」就是公差列，填「平面度」就是幾何公差列，
 * 其餘有數值的當尺寸、數值不是數字（例如材質：鋼）的當註記 —— 一律不自己編造數值。
 */
export type AnnotationRowKind = 'dimension' | 'tolerance' | 'gdt' | 'callout' | 'note';

const TOLERANCE_PATTERN = /公差|偏差|tolerance|\btol\b|±|\+\/-/i;
const GDT_PATTERN = /平面度|真直度|真圓度|圓度|圓筒度|垂直度|平行度|同心度|同軸度|位置度|輪廓度|傾斜度|偏轉度|跳動|flatness|straightness|circularity|cylindricity|perpendicularity|parallelism|concentricity|coaxiality|position|profile|angularity|runout|gd&t|gdt/i;
const CALLOUT_PATTERN = /件號|零件號|零件編號|料號|項次|編號|balloon|part\s*(no|number|#)|item\s*(no|#)/i;
const NUMERIC_PATTERN = /^[\s]*[-+±~<>]?\s*[\dØøΦφRr][\d.,\s±+\-×x*ØøΦφRr/]*\s*(mm|cm|m|in|°|deg|%|pcs)?\s*$/;

export function classifyAnnotationRow(key: string, value: string): AnnotationRowKind {
  const name = key.trim();
  if (CALLOUT_PATTERN.test(name)) return 'callout';
  if (GDT_PATTERN.test(name)) return 'gdt';
  if (TOLERANCE_PATTERN.test(name)) return 'tolerance';
  return NUMERIC_PATTERN.test(value.trim()) ? 'dimension' : 'note';
}

export interface AnnotationRow {
  key: string;
  value: string;
  kind: AnnotationRowKind;
  /** 零件編號引線的序號（1 起算），其餘列為 0。 */
  index: number;
}

/** 依標註開關挑出要疊加的列；關掉的項目一列都不留，圖面才會乾淨。 */
export function annotationRows(intent: DrawingIntent): AnnotationRow[] {
  const a = intent.annotation;
  const rows: AnnotationRow[] = [];
  let calloutIndex = 0;
  for (const [key, value] of Object.entries(intent.measurements)) {
    if (!key.trim() || !value.trim()) continue;
    const kind = classifyAnnotationRow(key, value);
    const enabled =
      kind === 'dimension' || kind === 'note' ? a.dimensions
      : kind === 'tolerance' ? a.tolerance
      : kind === 'gdt' ? a.gdt
      : a.callouts;
    if (!enabled) continue;
    rows.push({ key: key.trim(), value: value.trim(), kind, index: kind === 'callout' ? ++calloutIndex : 0 });
  }
  return rows;
}

/** 疊加層只屬於「應用程式精確疊加」模式；生圖模型繪製模式由模型負責。 */
export function annotationOverlayActive(intent: DrawingIntent): boolean {
  return intent.text.renderMode === 'application';
}

/** 生圖前要保留多高的標註帶；0 表示這一張圖不需要保留（不浪費版面）。 */
export function annotationBandHeight(intent: DrawingIntent): number {
  if (!annotationOverlayActive(intent)) return 0;
  const rows = annotationRows(intent).length;
  if (rows === 0) return 0;
  return Math.min(BAND_MAX, Math.max(BAND_MIN, rows * ROW_HEIGHT + BAND_PADDING));
}

/* --------------------------------------------------------------------------
   圖元
   -------------------------------------------------------------------------- */

export type AnnotationPrimitive =
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number }
  /** 實心箭頭：三角形三個點，依序為 [x0,y0,x1,y1,x2,y2]。 */
  | { kind: 'arrow'; points: readonly number[] }
  | { kind: 'rect'; x: number; y: number; w: number; h: number; fill: 'none' | 'paper' }
  | { kind: 'circle'; cx: number; cy: number; r: number; fill: 'none' | 'paper' }
  | {
      kind: 'text';
      x: number;
      y: number;
      text: string;
      size: number;
      anchor: 'start' | 'middle' | 'end';
      weight: 'normal' | 'bold';
    };

export interface AnnotationOverlayInput {
  intent: DrawingIntent;
  layout: SheetLayout;
  viewHeight: number;
}

const round = (value: number) => (Number.isFinite(value) ? Math.round(value * 100) / 100 : 0);

/** 由標註帶的位置算出整組疊加圖元。沒有標註帶就回空陣列（不必多包一層 SVG）。 */
export function annotationPrimitives(input: AnnotationOverlayInput): AnnotationPrimitive[] {
  const band: SheetRect | null = input.layout.annotation ?? null;
  const rows = annotationRows(input.intent);
  if (!band || rows.length === 0) return [];

  const out: AnnotationPrimitive[] = [];
  const scale = input.viewHeight / 100;
  const bx = band.x * SHEET_VIEW_WIDTH;
  const bw = band.w * SHEET_VIEW_WIDTH;
  const by = band.y * input.viewHeight;
  const bh = band.h * input.viewHeight;
  const slot = bh / rows.length;
  /* 字級跟著列高縮：列數多時字不會擠在一起，列數少時也不會大得誇張。 */
  const size = Math.max(6, Math.min(2.1 * scale, slot * 0.5));
  const left = bx + 6;
  const x1 = bx + bw * 0.3;
  const x2 = bx + bw * 0.88;

  rows.forEach((row, index) => {
    const top = by + index * slot;
    const lineY = round(top + slot * 0.62);
    const baseline = round(lineY + size * 0.34);

    if (row.kind === 'dimension') {
      /* 名稱靠左、尺寸線置中、數值壓在線上（底下墊紙色，線才不會穿過字）。 */
      out.push({ kind: 'text', x: round(left), y: baseline, text: row.key, size: round(size * 0.88), anchor: 'start', weight: 'normal' });
      out.push({ kind: 'line', x1: round(x1), y1: lineY, x2: round(x2), y2: lineY });
      for (const [at, dir] of [[x1, -1], [x2, 1]] as const) {
        /* 延伸線短豎：標出尺寸線的兩端，讀起來才像尺寸而不是一條橫線。 */
        out.push({ kind: 'line', x1: round(at), y1: round(lineY - size * 0.86), x2: round(at), y2: round(lineY + size * 0.3) });
        const back = at - dir * size * 1.05;
        out.push({
          kind: 'arrow',
          points: [round(at), lineY, round(back), round(lineY - size * 0.28), round(back), round(lineY + size * 0.28)],
        });
      }
      const middle = (x1 + x2) / 2;
      const width = estimateTextWidth(row.value, size);
      out.push({ kind: 'rect', x: round(middle - width / 2 - size * 0.28), y: round(lineY - size * 0.7), w: round(width + size * 0.56), h: round(size * 0.92), fill: 'paper' });
      out.push({ kind: 'text', x: round(middle), y: baseline, text: row.value, size: round(size), anchor: 'middle', weight: 'bold' });
      return;
    }

    if (row.kind === 'gdt') {
      /* 特徵控制框：名稱一格、數值一格。符號與基準由使用者填的名稱/數值決定，程式不代填。 */
      const cell = size * 1.52;
      const keyWidth = estimateTextWidth(row.key, size * 0.82) + size * 0.9;
      const valueWidth = Math.max(cell, estimateTextWidth(row.value, size * 0.82) + size * 0.9);
      const frameY = round(lineY - cell * 0.72);
      out.push({ kind: 'rect', x: round(x1), y: frameY, w: round(keyWidth + valueWidth), h: round(cell), fill: 'none' });
      out.push({ kind: 'line', x1: round(x1 + keyWidth), y1: frameY, x2: round(x1 + keyWidth), y2: round(frameY + cell) });
      out.push({ kind: 'text', x: round(x1 + keyWidth / 2), y: round(frameY + cell * 0.72), text: row.key, size: round(size * 0.82), anchor: 'middle', weight: 'normal' });
      out.push({ kind: 'text', x: round(x1 + keyWidth + valueWidth / 2), y: round(frameY + cell * 0.72), text: row.value, size: round(size * 0.82), anchor: 'middle', weight: 'bold' });
      return;
    }

    if (row.kind === 'callout') {
      /* 零件編號引線：氣球＋引線＋圓點，編號取這一列在清單中的序號。 */
      const r = size * 0.82;
      const cy = round(lineY - size * 0.06);
      out.push({ kind: 'circle', cx: round(x1 + r), cy, r: round(r), fill: 'paper' });
      out.push({ kind: 'text', x: round(x1 + r), y: round(cy + size * 0.34), text: String(row.index), size: round(size * 0.86), anchor: 'middle', weight: 'bold' });
      out.push({ kind: 'line', x1: round(x1 + r * 2), y1: cy, x2: round(x1 + r * 2 + bw * 0.08), y2: cy });
      out.push({ kind: 'circle', cx: round(x1 + r * 2 + bw * 0.08), cy, r: round(size * 0.16), fill: 'paper' });
      out.push({ kind: 'text', x: round(x1 + r * 2 + bw * 0.1), y: baseline, text: `${row.key} ${row.value}`, size: round(size * 0.88), anchor: 'start', weight: 'normal' });
      return;
    }

    /* 公差列與一般註記列：一行文字，左邊名稱、右邊內容。 */
    out.push({ kind: 'text', x: round(left), y: baseline, text: row.key, size: round(size * 0.88), anchor: 'start', weight: 'normal' });
    out.push({ kind: 'text', x: round(x1), y: baseline, text: row.value, size: round(size), anchor: 'start', weight: row.kind === 'tolerance' ? 'bold' : 'normal' });
  });

  return out;
}

/** 把圖元轉成 SVG 片段（匯出用；畫布預覽用 React 產生同樣的形狀）。 */
export function annotationSvg(primitives: readonly AnnotationPrimitive[], ink: string, paper: string): string {
  const escape = (text: string) =>
    text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return primitives
    .map((primitive) => {
      if (primitive.kind === 'line') {
        return `<line data-layer="ANNOTATION" x1="${round(primitive.x1)}" y1="${round(primitive.y1)}" x2="${round(primitive.x2)}" y2="${round(primitive.y2)}" stroke="${ink}" stroke-width="1.1" />`;
      }
      if (primitive.kind === 'arrow') {
        const points = [];
        for (let i = 0; i + 1 < primitive.points.length; i += 2) points.push(`${round(primitive.points[i])},${round(primitive.points[i + 1])}`);
        return `<polygon data-layer="ANNOTATION" points="${points.join(' ')}" fill="${ink}" stroke="${ink}" stroke-width="0.6" stroke-linejoin="round" />`;
      }
      if (primitive.kind === 'rect') {
        const fill = primitive.fill === 'paper' ? paper : 'none';
        return `<rect data-layer="ANNOTATION" x="${round(primitive.x)}" y="${round(primitive.y)}" width="${round(primitive.w)}" height="${round(primitive.h)}" fill="${fill}" stroke="${ink}" stroke-width="1.1" />`;
      }
      if (primitive.kind === 'circle') {
        const fill = primitive.fill === 'paper' ? paper : 'none';
        return `<circle data-layer="ANNOTATION" cx="${round(primitive.cx)}" cy="${round(primitive.cy)}" r="${round(primitive.r)}" fill="${fill}" stroke="${ink}" stroke-width="1.1" />`;
      }
      return `<text data-layer="ANNOTATION" x="${round(primitive.x)}" y="${round(primitive.y)}" font-size="${round(primitive.size)}" font-weight="${primitive.weight}" text-anchor="${primitive.anchor}" fill="${ink}">${escape(primitive.text)}</text>`;
    })
    .join('');
}
