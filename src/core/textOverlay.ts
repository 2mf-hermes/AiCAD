/* ============================================================================
   草稿文字標示 → 生圖後補回
   ----------------------------------------------------------------------------
   生圖（擴散）模型畫字幾乎必然出現亂碼，所以文字一律不交給它：
     1. 文字模型在 SVG 草稿裡用 <text> 標出標示與座標（draft.ts 擷取成 DrawingTextLabel）。
     2. 送給生圖模型的草稿 PNG 已剝除所有文字，提示詞同時要求「不得畫任何文字」。
     3. 生圖完成後，應用程式依正規化座標把標示疊回畫面（預覽為 SVG、匯出時合成進 PNG）。
   座標使用 0..1 正規化值，因此與輸出解析度、預覽縮放無關。
   ========================================================================== */

import type { DrawingIntent, DrawingTextLabel } from './types';

/** 支援中日韓字形的字體堆疊：Windows 內建字體優先，避免缺字變成方塊。 */
export const LABEL_FONT_STACK =
  '"Microsoft JhengHei UI", "Microsoft JhengHei", "Microsoft YaHei UI", "Microsoft YaHei", "Yu Gothic UI", "Malgun Gothic", "Noto Sans CJK TC", "Noto Sans CJK SC", "PingFang TC", "Segoe UI", sans-serif';

/** 只有「應用程式負責文字」且圖面確實有語言時才補回標示；交給生圖模型畫字時不重複疊加。 */
export function shouldOverlayLabels(intent: Pick<DrawingIntent, 'text' | 'textLanguage'>): boolean {
  return intent.text.renderMode !== 'image-model' && intent.textLanguage !== 'none';
}

export interface PlacedLabel {
  text: string;
  x: number;
  y: number;
  fontSize: number;
  anchor: DrawingTextLabel['anchor'];
  rotate: number;
}

/** 把正規化標示換算到指定像素尺寸。字高以高度為基準並設下限，小圖也能辨識。 */
export function placeLabels(labels: readonly DrawingTextLabel[], width: number, height: number): PlacedLabel[] {
  if (!(width > 0) || !(height > 0)) return [];
  return labels.map((label) => ({
    text: label.text,
    x: label.x * width,
    y: label.y * height,
    fontSize: Math.max(10, label.size * height),
    anchor: label.anchor,
    rotate: label.rotate,
  }));
}

/** 舊檔/外部資料的防呆正規化：任何欄位不合法就丟掉該筆，不讓整個專案載入失敗。 */
export function normalizeTextLabels(value: unknown): DrawingTextLabel[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
  const out = value.slice(0, 60).flatMap((item): DrawingTextLabel[] => {
    if (!item || typeof item !== 'object') return [];
    const raw = item as Record<string, unknown>;
    const text = typeof raw.text === 'string' ? raw.text.replace(/\s+/g, ' ').trim().slice(0, 60) : '';
    const { x, y } = raw;
    if (!text || typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return [];
    const size = typeof raw.size === 'number' && Number.isFinite(raw.size) ? Math.max(0.005, Math.min(0.08, raw.size)) : 0.02;
    const rotate = typeof raw.rotate === 'number' && Number.isFinite(raw.rotate) ? Math.max(-90, Math.min(90, raw.rotate)) : 0;
    const anchor = raw.anchor === 'middle' || raw.anchor === 'end' ? raw.anchor : 'start';
    return [{ text, x: clamp01(x), y: clamp01(y), size, rotate, anchor }];
  });
  return out.length > 0 ? out : undefined;
}

/** 匯出 PNG：把標示燒進圖片，讓匯出結果與畫面預覽一致（含白色描邊光暈）。 */
export async function compositeLabelsPng(imageRef: string, labels: readonly DrawingTextLabel[], dark = false): Promise<string> {
  if (labels.length === 0) return imageRef;
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('圖片載入失敗'));
    img.src = imageRef;
  });
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return imageRef;
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  for (const label of placeLabels(labels, canvas.width, canvas.height)) {
    ctx.save();
    ctx.translate(label.x, label.y);
    if (label.rotate) ctx.rotate((label.rotate * Math.PI) / 180);
    ctx.font = `500 ${label.fontSize}px ${LABEL_FONT_STACK}`;
    ctx.textAlign = label.anchor === 'middle' ? 'center' : label.anchor === 'end' ? 'right' : 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(2, label.fontSize * 0.22);
    ctx.strokeStyle = dark ? 'rgba(15, 43, 70, 0.92)' : 'rgba(255, 255, 255, 0.94)';
    ctx.strokeText(label.text, 0, 0);
    ctx.fillStyle = dark ? '#eaf3ff' : '#15191e';
    ctx.fillText(label.text, 0, 0);
    ctx.restore();
  }
  return canvas.toDataURL('image/png');
}
