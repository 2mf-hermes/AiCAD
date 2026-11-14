import { describe, expect, it } from 'vitest';
import {
  annotationPrimitives,
  resolveAnnotationPlacements,
  type AnnotationPlacement,
} from './annotationOverlay';
import { annotationPositionsFor } from './annotationPlacementMap';
import { sheetLayout } from './sheetLayout';
import { sheetViewHeight } from './sheetFurniture';
import { createDefaultIntent } from './types';
import type { Artboard, DrawingIntent } from './types';

/* 一組必然有標註列的 intent：尺寸列有值，標註帶高度才不會是 0。 */
function intentWithRows(): DrawingIntent {
  const intent = createDefaultIntent();
  intent.annotation.dimensions = true;
  intent.measurements = { '總長': '120', '孔徑': '×12' };
  return intent;
}

describe('標註定位（視圖模型回報位置）', () => {
  const intent = intentWithRows();
  const layout = sheetLayout({
    titleBlock: true,
    measurements: true,
    scaleBar: false,
    annotation: 0.144,
  });
  const viewHeight = sheetViewHeight(1600, 1000);

  it('有位置的那一列被搬到模型指的位置，其餘仍留在標註帶上', () => {
    const band = annotationPrimitives({ intent, layout, viewHeight });
    const placements: AnnotationPlacement[] = [{ key: '總長', x: 0.2, y: 0.3 }];
    const { positions } = resolveAnnotationPlacements({ intent, layout, viewHeight }, placements);
    const placed = annotationPrimitives({ intent, layout, viewHeight, placements: positions });

    /* 圖元數量不變 —— 只是位置換了，代表兩條路徑共用同一個繪製函式。 */
    expect(placed.length).toBe(band.length);
    /* 但整組文字不再都落在標註帶裡。 */
    const bandTop = (layout.annotation?.y ?? 0) * viewHeight;
    const textYs = (prims: typeof band) =>
      prims.filter((p): p is Extract<typeof p, { kind: 'text' }> => p.kind === 'text').map((p) => p.y);
    expect(textYs(placed)).not.toEqual(textYs(band));
    expect(textYs(placed).some((y) => y < bandTop)).toBe(true);
  });

  it('名稱對不上的位置一律丟棄，不會多畫出字', () => {
    const placements: AnnotationPlacement[] = [{ key: '不存在的標註', x: 0.2, y: 0.3 }];
    const { positions, used, dropped } = resolveAnnotationPlacements({ intent, layout, viewHeight }, placements);
    expect(positions.size).toBe(0);
    expect(used).toBe(0);
    expect(dropped).toBe(1);
  });

  it('落到標題欄這一類禁區的位置會被推開，不會壓在圖框上', () => {
    const titleBlock = layout.titleBlock;
    expect(titleBlock).not.toBeNull();
    if (!titleBlock) return;
    const placements: AnnotationPlacement[] = [
      { key: '總長', x: titleBlock.x + titleBlock.w / 2, y: titleBlock.y + titleBlock.h / 2 },
    ];
    const { positions, clamped } = resolveAnnotationPlacements({ intent, layout, viewHeight }, placements);
    expect(clamped).toBeGreaterThan(0);
    const placed = positions.get('總長');
    expect(placed).toBeDefined();
    const insideTitle =
      placed!.x >= titleBlock.x &&
      placed!.x <= titleBlock.x + titleBlock.w &&
      placed!.y >= titleBlock.y &&
      placed!.y <= titleBlock.y + titleBlock.h;
    expect(insideTitle).toBe(false);
  });

  it('沒有位置的舊圖完全照舊：annotationPositionsFor 回 undefined', () => {
    const artboard = { annotationPlacements: undefined } as unknown as Artboard;
    expect(annotationPositionsFor(artboard, layout, viewHeight)).toBeUndefined();
  });

  it('有位置時回傳的是圖面單位的位置表，可直接餵給疊加層', () => {
    const artboard = {
      intent,
      annotationPlacements: [{ key: '總長', x: 0.2, y: 0.3 }],
    } as unknown as Artboard;
    const positions = annotationPositionsFor(artboard, layout, viewHeight);
    expect(positions?.has('總長')).toBe(true);
    expect(positions!.get('總長')!.x).toBeLessThanOrEqual(1000);
    expect(positions!.get('總長')!.y).toBeLessThanOrEqual(viewHeight);
  });
});
