/* ============================================================================
   圖框內容（Sheet Furniture）
   ----------------------------------------------------------------------------
   畫布（DOM）與匯出（SVG／PNG／DXF）都吃同一份圖框內容，所以標題欄、比例尺、
   尺寸列只實作一次。這裡只產生「圖元資料」，不碰 React、不碰 canvas API ——
   於是同一份結果可以分別餵給三種輸出，位置永遠一致。

   座標單位是「圖面單位」：viewBox 為 1000 × sheetHeight(width,height)。
   ========================================================================== */

import type { DrawingTextSpec } from './types';
import { type SheetLayout, type SheetRect } from './sheetLayout';

export interface FurnitureRectPrimitive {
  kind: 'rect';
  x: number;
  y: number;
  w: number;
  h: number;
  /** 只描邊的框架 */
  stroke: boolean;
  /** 填白底（避免疊在圖面上時透出底色） */
  fill: boolean;
  role: 'frame' | 'cell' | 'bar';
}

export interface FurnitureLinePrimitive {
  kind: 'line';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  role: 'rule' | 'tick' | 'bar';
}

export interface FurnitureTextPrimitive {
  kind: 'text';
  x: number;
  y: number;
  text: string;
  size: number;
  anchor: 'start' | 'middle' | 'end';
  weight: 'normal' | 'bold';
  role: 'title' | 'label' | 'value' | 'caption';
}

export type FurniturePrimitive = FurnitureRectPrimitive | FurnitureLinePrimitive | FurnitureTextPrimitive;

/** 圖面單位 → 像素的等比換算（寬度固定 1000）。 */
export const SHEET_VIEW_WIDTH = 1000;

export function sheetViewHeight(width: number, height: number): number {
  if (!(width > 0) || !(height > 0)) return 700;
  return Math.round((SHEET_VIEW_WIDTH * height) / width);
}

/** 粗略字寬估算：CJK 視為 1em、其餘視為 0.56em。只用在「標籤接數值」的排版間距。 */
export function estimateTextWidth(text: string, size: number): number {
  let em = 0;
  for (const char of text) em += /[\u2E80-\u9FFF\uAC00-\uD7AF\uFF00-\uFFEF]/.test(char) ? 1 : 0.56;
  return em * size;
}

export interface SheetFurnitureInput {
  layout: SheetLayout;
  text: DrawingTextSpec;
  measurements: Record<string, string>;
  /** 標題欄列名等語系文字由呼叫端提供，核心層不依賴 i18n。 */
  labels: { date: string; scaleBar: string };
  viewHeight: number;
}

/** 產生整張紙的圖框內容（圖框線、標題欄、比例尺、尺寸列）。 */
export function sheetFurniture(input: SheetFurnitureInput): FurniturePrimitive[] {
  const out: FurniturePrimitive[] = [];
  const { layout, viewHeight } = input;
  const scale = viewHeight / 100;
  const sx = (value: number) => value * SHEET_VIEW_WIDTH;
  const sy = (value: number) => value * viewHeight;

  if (layout.frame) {
    out.push({ kind: 'rect', x: sx(layout.frame.x), y: sy(layout.frame.y), w: sx(layout.frame.w), h: sy(layout.frame.h), stroke: true, fill: false, role: 'frame' });
  }
  if (layout.footer) {
    const f = layout.footer;
    out.push({ kind: 'line', x1: sx(f.x), y1: sy(f.y), x2: sx(f.x + f.w), y2: sy(f.y), role: 'rule' });
  }

  if (layout.titleBlock) out.push(...titleBlockPrimitives(layout.titleBlock, input, sx, sy, scale));
  if (layout.scaleBar) out.push(...scaleBarPrimitives(layout.scaleBar, input, sx, sy, scale));
  if (layout.measurements) out.push(...measurementPrimitives(layout.measurements, input, sx, sy, scale));
  return out;
}

function titleBlockPrimitives(
  rect: SheetRect,
  input: SheetFurnitureInput,
  sx: (v: number) => number,
  sy: (v: number) => number,
  scale: number,
): FurniturePrimitive[] {
  const out: FurniturePrimitive[] = [];
  const x = sx(rect.x);
  const y = sy(rect.y);
  const w = sx(rect.w);
  const h = sy(rect.h);
  out.push({ kind: 'rect', x, y, w, h, stroke: true, fill: true, role: 'cell' });

  const titleSize = scale * 1.9;
  const titleH = Math.min(h * 0.34, titleSize * 1.9);
  const title = input.text.title.trim();
  out.push({ kind: 'line', x1: x, y1: y + titleH, x2: x + w, y2: y + titleH, role: 'rule' });
  out.push({
    kind: 'text',
    x: x + scale * 0.7,
    y: y + titleH * 0.5 + titleSize * 0.36,
    text: clampText(title, widthBudget(w - scale * 1.4, titleSize)),
    size: titleSize,
    anchor: 'start',
    weight: 'bold',
    role: 'title',
  });

  const rows: [string, string][] = [];
  const date = input.text.date.trim();
  if (date) rows.push([input.labels.date, date]);
  for (const field of input.text.customFields) {
    const key = field.key.trim();
    const value = field.value.trim();
    if (!key && !value) continue;
    rows.push([key, value]);
  }

  const bodyTop = y + titleH;
  const bodyH = Math.max(0, h - titleH);
  if (rows.length === 0) {
    out.push({ kind: 'line', x1: x, y1: bodyTop + bodyH * 0.5, x2: x + w, y2: bodyTop + bodyH * 0.5, role: 'rule' });
    return out;
  }

  const rowH = Math.min(bodyH / rows.length, scale * 2.6);
  const labelW = w * 0.42;
  const rowSize = Math.max(scale * 1.05, Math.min(scale * 1.45, rowH * 0.56));
  rows.forEach(([key, value], index) => {
    const top = bodyTop + rowH * index;
    if (index > 0) out.push({ kind: 'line', x1: x, y1: top, x2: x + w, y2: top, role: 'rule' });
    out.push({ kind: 'line', x1: x + labelW, y1: top, x2: x + labelW, y2: top + rowH, role: 'rule' });
    out.push({
      kind: 'text',
      x: x + scale * 0.5,
      y: top + rowH * 0.5 + rowSize * 0.36,
      text: clampText(key, widthBudget(labelW - scale, rowSize)),
      size: rowSize,
      anchor: 'start',
      weight: 'normal',
      role: 'label',
    });
    out.push({
      kind: 'text',
      x: x + labelW + scale * 0.5,
      y: top + rowH * 0.5 + rowSize * 0.36,
      text: clampText(value, widthBudget(w - labelW - scale, rowSize)),
      size: rowSize,
      anchor: 'start',
      weight: 'bold',
      role: 'value',
    });
  });
  return out;
}

function scaleBarPrimitives(
  rect: SheetRect,
  input: SheetFurnitureInput,
  sx: (v: number) => number,
  sy: (v: number) => number,
  scale: number,
): FurniturePrimitive[] {
  const out: FurniturePrimitive[] = [];
  const x = sx(rect.x);
  const y = sy(rect.y);
  const w = sx(rect.w);
  const barH = Math.max(scale * 0.9, sy(rect.h) * 0.34);
  const barY = y + barH * 0.4;
  /* 交替實心／空心的四段，是製圖常用的圖形比例尺；不寫數字，
     因為真實比例由出圖設定決定，硬寫一組數字反而是假資訊。 */
  const segments = 4;
  const segW = w / segments;
  for (let index = 0; index < segments; index += 1) {
    out.push({
      kind: 'rect',
      x: x + segW * index,
      y: barY,
      w: segW,
      h: barH,
      stroke: true,
      fill: index % 2 === 1,
      role: 'bar',
    });
  }
  const captionSize = scale * 1.1;
  out.push({
    kind: 'text',
    x,
    y: barY + barH + captionSize * 1.4,
    text: input.labels.scaleBar,
    size: captionSize,
    anchor: 'start',
    weight: 'normal',
    role: 'caption',
  });
  return out;
}

function measurementPrimitives(
  rect: SheetRect,
  input: SheetFurnitureInput,
  sx: (v: number) => number,
  sy: (v: number) => number,
  scale: number,
): FurniturePrimitive[] {
  const rows = Object.entries(input.measurements)
    .map(([key, value]) => [key.trim(), value.trim()] as [string, string])
    .filter(([key, value]) => key || value);
  if (rows.length === 0) return [];

  const columns = rows.length <= 2 ? 1 : rows.length <= 6 ? 2 : 3;
  const perColumn = Math.ceil(rows.length / columns);
  const x = sx(rect.x);
  const y = sy(rect.y);
  const w = sx(rect.w);
  const h = sy(rect.h);
  const columnW = w / columns;
  const rowH = Math.min(h / perColumn, scale * 2.6);
  const valueSize = Math.max(scale * 1.1, Math.min(scale * 1.55, rowH * 0.6));
  const labelSize = valueSize * 0.82;

  const out: FurniturePrimitive[] = [];
  rows.forEach(([key, value], index) => {
    const column = Math.floor(index / perColumn);
    const row = index % perColumn;
    const cx = x + columnW * column + scale * 0.4;
    const cy = y + rowH * row + rowH * 0.5;
    let cursor = cx;
    if (key) {
      const budget = Math.max(columnW * 0.5, columnW - scale * 8);
      const label = clampText(key, widthBudget(budget, labelSize));
      out.push({ kind: 'text', x: cursor, y: cy + labelSize * 0.36, text: label, size: labelSize, anchor: 'start', weight: 'normal', role: 'label' });
      cursor += estimateTextWidth(label, labelSize) + labelSize * 0.55;
    }
    if (value) {
      const valueRight = x + columnW * (column + 1) - scale * 0.4;
      const budget = Math.max(valueRight - cursor, scale * 4);
      const text = clampText(value, widthBudget(budget, valueSize));
      out.push({ kind: 'text', x: cursor, y: cy + valueSize * 0.36, text, size: valueSize, anchor: 'start', weight: 'bold', role: 'value' });
    }
  });
  return out;
}

function widthBudget(width: number, size: number): number {
  if (!(size > 0)) return 0;
  return Math.max(2, Math.floor(width / size));
}

function clampText(text: string, budget: number): string {
  const chars = Array.from(text);
  return chars.length <= budget ? text : `${chars.slice(0, Math.max(1, budget - 1)).join('')}…`;
}
