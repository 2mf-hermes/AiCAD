/* ============================================================================
   圖面合成（Sheet SVG）
   ----------------------------------------------------------------------------
   把「底稿／生圖結果 + 文字標示 + 圖框內容」合成一張 SVG。三個地方共用它：
     - 匯出 PNG（把 SVG 光柵化，文字與圖框位置與畫布完全一致）
     - 匯出 SVG（向量，可直接給 Illustrator／Inkscape）
     - CAD 匯出（解析同一份 SVG 轉 DXF，幾何與標註位置不會各寫一套）
   ========================================================================== */

import { LABEL_FONT_STACK, placeLabels } from './textOverlay';
import { annotationBandHeight, annotationPrimitives, annotationSvg } from './annotationOverlay';
import { SHEET_VIEW_WIDTH, sheetPaper, type FurniturePrimitive } from './sheetFurniture';
import { sheetLayout, type SheetLayout } from './sheetLayout';
import type { DrawingTextLabel } from './types';

export interface SheetSvgInput {
  width: number;
  height: number;
  /** 底圖（data: URL 或本機路徑）。與 draftSvg 同時給時，底圖在下、向量在上。 */
  imageRef?: string;
  /** 草稿向量（可選）。有它就能匯出真正的 CAD 幾何。 */
  draftSvg?: string;
  labels?: readonly DrawingTextLabel[];
  furniture?: readonly FurniturePrimitive[];
  /** 圖面分區；有它且應用程式疊加模式下才決定標註圖層落在哪裡。 */
  layout?: SheetLayout;
  /** 標註圖層（尺寸／公差／幾何公差／零件編號引線）的開關與來源。 */
  annotation?: Omit<AnnotationOverlaySource, 'layout'>;
  viewHeight: number;
  dark: boolean;
  /** 圖框文字顏色反轉（藍圖模式） */
  background?: string;
}

type AnnotationOverlaySource = Parameters<typeof annotationPrimitives>[0];

export const SHEET_INK = { light: '#12181f', dark: '#eef4ff' } as const;

const number = (value: number) => (Number.isFinite(value) ? Math.round(value * 100) / 100 : 0);

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** 把圖框圖元轉成 SVG 片段。`data-layer` 供 DXF 匯出分層用。 */
export function furnitureSvg(primitives: readonly FurniturePrimitive[], ink: string, paper: string = sheetPaper(false)): string {
  const out: string[] = [];
  for (const primitive of primitives) {
    if (primitive.kind === 'rect') {
      /* fill 代表「紙色底」，不是「墨色底」——用墨色填會把標題欄蓋成一大塊黑。 */
      out.push(
        `<rect data-layer="FRAME" x="${number(primitive.x)}" y="${number(primitive.y)}" width="${number(primitive.w)}" height="${number(primitive.h)}" fill="${primitive.fill ? paper : 'none'}" stroke="${ink}" stroke-width="1.1" />`,
      );
    } else if (primitive.kind === 'line') {
      out.push(
        `<line data-layer="FRAME" x1="${number(primitive.x1)}" y1="${number(primitive.y1)}" x2="${number(primitive.x2)}" y2="${number(primitive.y2)}" stroke="${ink}" stroke-width="1.1" />`,
      );
    } else {
      out.push(
        `<text data-layer="TEXT" x="${number(primitive.x)}" y="${number(primitive.y)}" font-size="${number(primitive.size)}" font-weight="${primitive.weight}" text-anchor="${primitive.anchor}" fill="${ink}">${escapeXml(primitive.text)}</text>`,
      );
    }
  }
  return out.join('');
}

/** 草稿文字標示：座標由像素換算進圖面單位，與畫布上的位置一致。 */
export function labelsSvg(
  labels: readonly DrawingTextLabel[],
  width: number,
  height: number,
  viewHeight: number,
  ink: string,
  halo: string,
): string {
  if (!labels.length || !(width > 0) || !(height > 0)) return '';
  const kx = SHEET_VIEW_WIDTH / width;
  const ky = viewHeight / height;
  const k = (kx + ky) / 2;
  return placeLabels(labels, width, height)
    .map((label) => {
      const transform = label.rotate ? ` transform="rotate(${number(label.rotate)} ${number(label.x * kx)} ${number(label.y * ky)})"` : '';
      return `<text data-layer="TEXT" x="${number(label.x * kx)}" y="${number(label.y * ky)}" font-size="${number(label.fontSize * k)}" text-anchor="${label.anchor}" fill="${ink}" stroke="${halo}" stroke-width="${number(Math.max(0.8, label.fontSize * k * 0.16))}" stroke-linejoin="round" paint-order="stroke"${transform}>${escapeXml(label.text)}</text>`;
    })
    .join('');
}

/**
 * 把向量底稿嵌進來。草稿 SVG 的外框尺寸與圖面一致，所以直接放大到整張紙；
 * 只改根標籤，不動內部內容，避免破壞路徑資料。
 */
export function nestDraftSvg(svg: string, viewHeight: number): string {
  const source = svg.trim();
  if (!source) return '';
  const start = source.indexOf('<svg');
  if (start < 0) return '';
  const openEnd = source.indexOf('>', start);
  if (openEnd < 0) return '';
  const head = source.slice(start + 4, openEnd);
  const cleaned = head
    .replace(/\s(width|height|x|y)="[^"]*"/g, '')
    .replace(/\spreserveAspectRatio="[^"]*"/g, '');
  const viewBox = /viewBox="[^"]*"/.test(cleaned) ? cleaned : ` viewBox="0 0 ${SHEET_VIEW_WIDTH} ${viewHeight}"${cleaned}`;
  const body = source.slice(openEnd + 1).replace(/<\/svg>\s*$/i, '');
  return `<svg x="0" y="0" width="${SHEET_VIEW_WIDTH}" height="${number(viewHeight)}" preserveAspectRatio="none"${viewBox}>${body}</svg>`;
}

/** 合成整張圖面。輸出是獨立 SVG（不含任何外部資源），可直接光柵化或存檔。 */
export function buildSheetSvg(input: SheetSvgInput): string {
  const ink = input.dark ? SHEET_INK.dark : SHEET_INK.light;
  const paper = input.background ?? sheetPaper(input.dark);
  const width = SHEET_VIEW_WIDTH;
  const height = number(input.viewHeight);
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${input.width}" height="${input.height}" viewBox="0 0 ${width} ${height}" font-family="${escapeXml(LABEL_FONT_STACK)}">`,
  );
  /* 一律鋪紙色：沒有底色時 PNG 會是透明底，圖框填白也會變成透明，看起來就像缺了標題欄。 */
  parts.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="${escapeXml(paper)}" />`);
  if (input.imageRef) {
    parts.push(
      `<image x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="none" href="${escapeXml(input.imageRef)}" xlink:href="${escapeXml(input.imageRef)}" />`,
    );
  }
  if (input.draftSvg) parts.push(nestDraftSvg(input.draftSvg, height));
  /* 標示用紙色描邊（halo）墊底：即使壓到線稿也讀得出來，這正是使用者抱怨「文字被圖面吃掉」的解法。 */
  if (input.labels?.length) {
    parts.push(labelsSvg(input.labels, input.width, input.height, height, ink, paper));
  }
  /* 標註圖層壓在圖框內容「之前」：圖框線與標題欄外框一定要蓋在標註帶邊界上，
     否則標註帶會把自己的邊框吃掉。 */
  if (input.annotation && input.layout) {
    /* 版面若沒帶標註帶高度（例如舊呼叫端只傳 titleBlock／scaleBar），這裡自己補算一次：
       否則畫面明明要疊標註，匯出卻是一條空陣列 —— 預覽有、存檔沒有，正是使用者最難查的那種錯。 */
    let band: SheetLayout = input.layout;
    const bandHeight = annotationBandHeight(input.annotation.intent);
    if (!band.annotation && bandHeight > 0) {
      band = {
        ...band,
        annotation:
          sheetLayout({
            titleBlock: input.annotation.intent.annotation.titleBlock,
            measurements: band.measurements !== null,
            scaleBar: input.annotation.intent.annotation.scaleBar,
            annotation: bandHeight,
          }).annotation,
      };
    }
    const primitives = annotationPrimitives({ ...input.annotation, layout: band });
    if (primitives.length) parts.push(annotationSvg(primitives, ink, paper));
  }
  if (input.furniture?.length) parts.push(furnitureSvg(input.furniture, ink, paper));
  parts.push('</svg>');
  return parts.join('');
}

/** 光柵化用：SVG 轉成可直接放進 <img> 的 data URL。 */
export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
