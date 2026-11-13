import { describe, expect, it } from 'vitest';
import { createCadEntity, createDefaultCadWorkspace } from './cad';
import { sheetToDxf } from './cadExport';
import { DIMENSION_MODE_LIST, arrowLines, dimensionGeometry } from './dimension';

/** 畫布與匯出共用的幾何：每一種尺寸類型都要畫出不同的東西。 */
describe('尺寸標註幾何', () => {
  const base = { start: { x: 0.2, y: 0.2 }, end: { x: 0.6, y: 0.2 }, layerId: 'dim' } as const;

  it('每一種類型都有自己的尺寸線或弧線，且都有箭頭與量測值', () => {
    const seen = new Set<string>();
    for (const mode of DIMENSION_MODE_LIST) {
      const entity = { ...base, id: 'd1', kind: 'dimension' as const, mode: mode.value, color: '#12181f', text: undefined, createdBy: 'user' as const };
      const geometry = dimensionGeometry(entity, []);
      expect(geometry.arrows.length).toBeGreaterThan(0);
      expect(geometry.text.value).not.toBe('');
      const signature = `${geometry.arc ? 'arc' : 'line'}:${geometry.arrows.length}:${geometry.extensions.length}`;
      seen.add(signature);
    }
    // 不是所有類型都長一樣：至少要分成三種以上不同的畫法。
    expect(seen.size).toBeGreaterThanOrEqual(3);
  });

  it('角度標註用弧線，線性與雙箭頭用直線', () => {
    const make = (mode: 'angular' | 'linear' | 'double-arrow') => ({ ...base, id: 'd', kind: 'dimension' as const, mode, color: '#12181f', text: undefined, createdBy: 'user' as const });
    expect(dimensionGeometry(make('angular'), []).arc).toBeDefined();
    expect(dimensionGeometry(make('linear'), []).arc).toBeUndefined();
    expect(dimensionGeometry(make('double-arrow'), []).extensions).toHaveLength(0);
  });

  it('輸入的數值會取代自動量測值', () => {
    const entity = { ...base, id: 'd', kind: 'dimension' as const, mode: 'linear' as const, color: '#12181f', text: 'R12.5', createdBy: 'user' as const };
    expect(dimensionGeometry(entity, []).text.value).toBe('R12.5');
    expect(dimensionGeometry({ ...entity, text: undefined }, []).text.value).toMatch(/^[0-9.]+$/);
  });

  it('箭頭是兩筆短線，端點落在給定的位置', () => {
    const [first, second] = arrowLines({ at: { x: 0.5, y: 0.5 }, dir: { x: 1, y: 0 } });
    expect(first.start).toEqual({ x: 0.5, y: 0.5 });
    expect(second.start).toEqual({ x: 0.5, y: 0.5 });
    expect(first.end).not.toEqual(second.end);
  });
});

describe('尺寸標註匯出 DXF', () => {
  it('尺寸以延伸線、尺寸線、箭頭與文字匯出，角度標註匯出 ARC', () => {
    const workspace = createDefaultCadWorkspace();
    const linear = createCadEntity(workspace, 'dimension', { x: 0.2, y: 0.2 }, { x: 0.6, y: 0.2 }, 'd1');
    const angular = createCadEntity({ ...workspace, dimensionMode: 'angular' }, 'dimension', { x: 0.2, y: 0.2 }, { x: 0.6, y: 0.5 }, 'd2');
    expect(linear?.kind).toBe('dimension');
    expect(angular?.kind).toBe('dimension');
    const result = sheetToDxf({
      sheetSvg: '<svg viewBox="0 0 1000 700"></svg>',
      paperWidth: 420,
      paperHeight: 297,
      viewHeight: 700,
      cadEntities: [linear!, angular!],
    });
    expect(result.counts.texts).toBe(2);
    expect(result.counts.arcs).toBe(1);
    expect(result.counts.lines).toBeGreaterThan(4);
    expect(result.dxf).toContain('ARC');
  });
});
