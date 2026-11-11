/* ============================================================================
   圖面光柵化（Sheet Raster）
   ----------------------------------------------------------------------------
   PNG 匯出必須與畫布上看到的完全一致：文字標示、標題欄、比例尺、尺寸列都是應用
   程式疊上去的，若只把生成器回傳的原圖存成 PNG，這些內容全都不會出現。
   作法是「先合成 SVG，再讓瀏覽器畫成點陣」—— 同一份 SVG 也用於 SVG／DXF 匯出，
   所以三種格式的位置永遠一致。

   注意：這裡刻意不引入外部字型或外部資源，SVG 必須是自足的，否則 <img> 載入會
   因為跨來源限制而變成空白圖。
   ========================================================================== */

import { svgDataUrl } from './sheetSvg';

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('圖面合成失敗'));
    image.src = url;
  });
}

/** 把合成後的 SVG 光柵化成 PNG data URL。 */
export async function rasterizeSheetSvg(svg: string, width: number, height: number): Promise<string> {
  const image = await loadImage(svgDataUrl(svg));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('無法建立畫布');
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}
