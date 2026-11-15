import { describe, expect, it } from 'vitest';
import {
  annotationBandHeight,
  annotationGroups,
  annotationLayerId,
  annotationPrimitives,
  annotationRows,
  isAnnotationLayerId,
} from './annotationOverlay';
import { buildSheetSvg } from './sheetSvg';
import { sheetLayout } from './sheetLayout';
import { sheetFurniture, sheetViewHeight } from './sheetFurniture';
import type { DrawingIntent } from './types';

const WIDTH = 1536;
const HEIGHT = 1024;

function intent(overrides: Partial<DrawingIntent['annotation']> = {}): DrawingIntent {
  return {
    subject: 'bracket',
    category: 'mechanical',
    categoryContent: '',
    projection: 'third',
    lineStyle: 'ink',
    paper: 'a3',
    detail: 'standard',
    textLanguage: 'zh-Hant',
    text: {
      title: 'TEST',
      sheetNumber: 'A-001',
      revision: 'A',
      author: '',
      renderMode: 'application',
      fields: [],
      date: '2026-08-30',
      customFields: [],
    },
    measurementUsage: 'annotate',
    measurements: { 總長: '120 mm', 厚度: '8 mm', 孔徑: '×12', 備註: '去毛邊' },
    annotation: { titleBlock: true, scaleBar: true, dimensions: true, tolerance: true, gdt: true, callouts: true, ...overrides },
    references: [],
  } as unknown as DrawingIntent;
}

function compose(source: DrawingIntent) {
  const band = annotationBandHeight(source);
  const layout = sheetLayout({ titleBlock: true, measurements: true, scaleBar: true, annotation: band });
  const viewHeight = sheetViewHeight(WIDTH, HEIGHT);
  const primitives = annotationPrimitives({ intent: source, layout, viewHeight });
  const svg = buildSheetSvg({
    width: WIDTH,
    height: HEIGHT,
    furniture: sheetFurniture({
      layout,
      text: source.text,
      measurements: source.measurements,
      labels: { date: '2026-08-30', scaleBar: '1:10' },
      viewHeight,
    }),
    layout,
    annotation: { intent: source, viewHeight },
    viewHeight,
    dark: false,
  });
  return { band, layout, primitives, svg };
}

describe('annotation overlay', () => {
  it('classifies numeric rows as dimensions and everything else as notes', () => {
    const rows = annotationRows(intent());
    const kindOf = (key: string) => rows.find((row) => row.key === key)?.kind;
    expect(kindOf('總長')).toBe('dimension');
    expect(kindOf('厚度')).toBe('dimension');
    // 「×12」不是純數值，分類器照設計歸成備註而不是尺寸值。
    expect(kindOf('孔徑')).toBe('note');
    expect(kindOf('備註')).toBe('note');
  });

  it('draws every annotation value into the exported sheet on its own layer', () => {
    const { primitives, svg } = compose(intent());
    const values = primitives.filter((p) => p.kind === 'text').map((p) => (p as { text: string }).text);
    expect(values).toContain('120 mm');
    expect(svg).toContain('data-layer="ANNOTATION"');
    // 值必須實際落在輸出圖裡，不能只存在於畫布 JSX。
    expect(svg).toContain('120 mm');
    expect(svg).toContain('去毛邊');
  });

  it('leaves no annotation band when every annotation item is switched off', () => {
    const off = intent({ titleBlock: false, scaleBar: false, dimensions: false, tolerance: false, gdt: false, callouts: false });
    expect(annotationBandHeight(off)).toBe(0);
  });

  it('gives every annotation item its own layer with its own geometry', () => {
    const source = intent();
    const layout = sheetLayout({ titleBlock: true, measurements: true, scaleBar: true, annotation: annotationBandHeight(source) });
    const viewHeight = sheetViewHeight(WIDTH, HEIGHT);
    const groups = annotationGroups({ intent: source, layout, viewHeight });

    // 一項標註一層，順序照標註清單，不是照繪製順序。
    expect(groups.map((group) => group.key)).toEqual(annotationRows(source).map((row) => row.key));
    expect(new Set(groups.map((group) => group.layerId)).size).toBe(groups.length);
    for (const group of groups) {
      expect(isAnnotationLayerId(group.layerId)).toBe(true);
      expect(group.primitives.length).toBeGreaterThan(0);
    }
    // 名稱才是身分：同一項標註重算幾次都落在同一層。
    expect(annotationLayerId('總長')).toBe(annotationLayerId(' 總長 '));
    expect(annotationLayerId('總長')).not.toBe(annotationLayerId('厚度'));
  });

  it('drops a switched-off annotation layer without moving the others', () => {
    const source = intent();
    const layout = sheetLayout({ titleBlock: true, measurements: true, scaleBar: true, annotation: annotationBandHeight(source) });
    const viewHeight = sheetViewHeight(WIDTH, HEIGHT);
    const all = annotationGroups({ intent: source, layout, viewHeight });
    const hidden = new Set([all[1].layerId]);
    const kept = annotationGroups({ intent: source, layout, viewHeight, hidden });

    expect(kept.map((group) => group.key)).toEqual([all[0].key, ...all.slice(2).map((group) => group.key)]);
    // 位置沿用原來的列序，關掉一項不會讓其他項跳位。
    expect(kept[0].primitives).toEqual(all[0].primitives);
    expect(kept[1].primitives).toEqual(all[2].primitives);
    // 攤平版本同步反映：關掉的項目一列都不留。
    const flat = annotationPrimitives({ intent: source, layout, viewHeight, hidden });
    expect(flat).toEqual(kept.flatMap((group) => group.primitives));
    expect(flat.length).toBeLessThan(annotationPrimitives({ intent: source, layout, viewHeight }).length);
  });
});
