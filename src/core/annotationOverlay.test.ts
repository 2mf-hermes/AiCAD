import { describe, expect, it } from 'vitest';
import { annotationBandHeight, annotationPrimitives, annotationRows } from './annotationOverlay';
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
});
