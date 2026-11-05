/* 草稿文字標示：擷取 → 剝除 → 正規化 → 補回 的迴歸測試 */
import { describe, expect, it } from 'vitest';
import { extractTextLabels, normalizeDraftSvg } from './pipeline/draft';
import { normalizeTextLabels, placeLabels, shouldOverlayLabels } from './textOverlay';
import { createDefaultIntent } from './types';

const RAW = [
  'Sure:',
  '```svg',
  '<svg viewBox="0 0 1000 700">',
  '<rect x="100" y="100" width="300" height="200"/>',
  '<text x="250" y="90" text-anchor="middle" font-size="14">前視圖 &amp; A</text>',
  '<text x="500" y="350" font-size="999" transform="rotate(-90 500 350)">Ø20</text>',
  '<text x="nope" y="1">bad</text>',
  '<text x="10" y="10"></text>',
  '</svg>',
  '```',
].join('\n');

describe('extractTextLabels', () => {
  it('把草稿 <text> 換成 0..1 正規化座標並解碼實體', () => {
    const labels = extractTextLabels(RAW);
    expect(labels).toHaveLength(2);
    expect(labels[0]).toMatchObject({ text: '前視圖 & A', anchor: 'middle', rotate: 0 });
    expect(labels[0].x).toBeCloseTo(0.25);
    expect(labels[0].y).toBeCloseTo(90 / 700);
    expect(labels[0].size).toBeCloseTo(14 / 700);
  });

  it('夾住異常字級與旋轉，丟掉無座標或空白的標示', () => {
    const [, second] = extractTextLabels(RAW);
    expect(second.size).toBeCloseTo(32 / 700);
    expect(second.rotate).toBe(-90);
  });

  it('遵守數量上限', () => {
    const many = `<svg>${'<text x="1" y="1">a</text>'.repeat(80)}<line x2="5"/></svg>`;
    expect(extractTextLabels(many, 40)).toHaveLength(40);
  });

  it('送給生圖模型的草稿已剝除全部文字', () => {
    const svg = normalizeDraftSvg(RAW) as string;
    expect(svg).not.toContain('<text');
    expect(svg).not.toContain('前視圖');
    expect(svg).toContain('<rect');
  });
});

describe('placeLabels', () => {
  it('依輸出尺寸換算像素，並保證最小字高', () => {
    const [placed] = placeLabels([{ text: 'A', x: 0.5, y: 0.25, anchor: 'middle', size: 0.001, rotate: 0 }], 2000, 1000);
    expect(placed.x).toBe(1000);
    expect(placed.y).toBe(250);
    expect(placed.fontSize).toBe(10);
  });

  it('尺寸無效時不輸出', () => {
    expect(placeLabels([{ text: 'A', x: 0, y: 0, anchor: 'start', size: 0.02, rotate: 0 }], 0, 100)).toEqual([]);
  });
});

describe('normalizeTextLabels', () => {
  it('舊檔沒有欄位時維持 undefined', () => {
    expect(normalizeTextLabels(undefined)).toBeUndefined();
    expect(normalizeTextLabels('x')).toBeUndefined();
    expect(normalizeTextLabels([])).toBeUndefined();
  });

  it('夾住範圍、丟棄壞資料、截斷長字串', () => {
    const out = normalizeTextLabels([
      { text: 'ok', x: 2, y: -1, size: 9, rotate: 400, anchor: 'weird' },
      { text: '', x: 0, y: 0 },
      { text: 'nan', x: Number.NaN, y: 0 },
      null,
      { text: 'x'.repeat(200), x: 0.5, y: 0.5 },
    ]) ?? [];
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ text: 'ok', x: 1, y: 0, size: 0.08, rotate: 90, anchor: 'start' });
    expect(out[1].text).toHaveLength(60);
    expect(out[1].size).toBe(0.02);
  });
});

describe('shouldOverlayLabels', () => {
  it('只在應用程式負責文字且有語言時補回', () => {
    const base = createDefaultIntent();
    expect(shouldOverlayLabels({ ...base, text: { ...base.text, renderMode: 'application' }, textLanguage: 'en' })).toBe(true);
    expect(shouldOverlayLabels({ ...base, text: { ...base.text, renderMode: 'text-model-overlay' }, textLanguage: 'en' })).toBe(true);
    expect(shouldOverlayLabels({ ...base, text: { ...base.text, renderMode: 'image-model' }, textLanguage: 'en' })).toBe(false);
    expect(shouldOverlayLabels({ ...base, text: { ...base.text, renderMode: 'application' }, textLanguage: 'none' })).toBe(false);
  });
});
