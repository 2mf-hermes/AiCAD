/* 草稿 → SVG → 生圖：正規化與摘要的迴歸測試 */
import { describe, expect, it } from 'vitest';
import {
  buildDraftRequest,
  buildDraftSystemPrompt,
  extractSvg,
  mergeDraftIntoPrompt,
  normalizeDraftSvg,
  summarizeDraft,
} from './draft';
import { systemInstructionFor, REFINE_SYSTEM_PROMPT } from '../prompt/builder';
import type { DrawingIntent } from '../types';

const intent = (): DrawingIntent =>
  ({
    kind: 'mechanical-part',
    subject: 'bracket',
    categoryContent: '',
    notes: '',
    lineStyle: 'technical-ink',
    textLanguage: 'zh-Hant',
    annotation: { dimensions: true, unit: 'mm', projection: 'first', tolerance: false },
    text: { renderMode: 'application', title: '', date: '', customFields: [] },
    measurements: { 長度: '120 mm' },
    exclude: [],
    references: [],
  }) as unknown as DrawingIntent;

describe('extractSvg', () => {
  it('剝掉 markdown 圍籬與前後的說明文字', () => {
    const raw = 'Here you go:\n```svg\n<svg viewBox="0 0 10 10"><line x1="0" y1="0" x2="5" y2="5"/></svg>\n```\nDone.';
    expect(extractSvg(raw)).toBe('<svg viewBox="0 0 10 10"><line x1="0" y1="0" x2="5" y2="5"/></svg>');
  });

  it('沒有 svg 元素時回傳空字串，而不是硬湊', () => {
    expect(extractSvg('I cannot draw that.')).toBe('');
    expect(extractSvg('')).toBe('');
  });
});

describe('normalizeDraftSvg', () => {
  it('強制套用自己的 viewBox，忽略模型給的尺寸', () => {
    const out = normalizeDraftSvg('<svg width="99999" height="5" viewBox="0 0 1 1"><rect x="1" y="1" width="2" height="2"/></svg>');
    expect(out).toContain('viewBox="0 0 1000 700"');
    expect(out).not.toContain('99999');
    expect(out).not.toContain('height="5"');
  });

  it('移除文字元素與外部參照，避免渲染與安全問題', () => {
    const out = normalizeDraftSvg(
      '<svg><text x="1" y="1">TITLE</text><image href="https://evil.example/x.png"/>' +
        '<rect x="1" y="1" width="2" height="2" href="javascript:alert(1)" fill="url(#g)"/></svg>',
    ) as string;
    expect(out).not.toContain('<text');
    expect(out).not.toContain('TITLE');
    expect(out).not.toContain('<image');
    expect(out).not.toContain('javascript');
    expect(out).not.toContain('url(');
    expect(out).toContain('fill="none"');
  });

  it('把顏色一律壓成黑色線稿，避免深色填滿吃掉整張圖', () => {
    const out = normalizeDraftSvg('<svg><circle cx="5" cy="5" r="2" fill="#ff0000" stroke="blue"/></svg>') as string;
    expect(out).toContain('stroke="#000"');
    expect(out).toContain('fill="none"');
    expect(out).not.toContain('#ff0000');
  });

  it('保留線寬與虛線，這些是工程圖的語意', () => {
    const out = normalizeDraftSvg('<svg><line x1="0" y1="0" x2="9" y2="9" stroke-width="3" stroke-dasharray="4 2"/></svg>') as string;
    expect(out).toContain('stroke-width="3"');
    expect(out).toContain('stroke-dasharray="4 2"');
  });

  it('補齊沒有關閉的標籤，讓救得回來的草稿仍可使用', () => {
    const out = normalizeDraftSvg('<svg><g><rect x="1" y="1" width="2" height="2">') as string;
    expect(out.endsWith('</g></svg>')).toBe(true);
    expect((out.match(/<rect/g) ?? []).length).toBe(1);
  });

  it('完全沒有幾何時回傳 null，讓呼叫端走備援', () => {
    expect(normalizeDraftSvg('<svg><style>line{}</style></svg>')).toBeNull();
    expect(normalizeDraftSvg('no svg at all')).toBeNull();
  });
});

describe('summarizeDraft', () => {
  it('數出各類幾何並保持一行可讀', () => {
    const svg = normalizeDraftSvg(
      '<svg><line x2="900"/><line x2="400"/><circle cx="500" cy="300" r="20"/><rect x="40" y="40" width="10" height="10"/></svg>',
    ) as string;
    const summary = summarizeDraft(svg);
    expect(summary).toContain('2 line');
    expect(summary).toContain('1 circle');
    expect(summary).toContain('1 rect');
    expect(summary).not.toContain('\n');
  });

  it('超長摘要會被截短，不會把提示詞撐爆', () => {
    const many = `<svg>${'<line x1="1" y1="1" x2="900" y2="900"/>'.repeat(400)}</svg>`;
    expect(summarizeDraft(normalizeDraftSvg(many) as string).length).toBeLessThanOrEqual(1400);
  });
});

describe('草稿提示詞', () => {
  it('草稿指令要求 SVG，只允許受限的 <text> 標示', () => {
    const prompt = buildDraftSystemPrompt();
    expect(prompt).toMatch(/<svg>/);
    expect(prompt).toContain('<text> is allowed ONLY');
    expect(prompt).toContain('Do NOT include <tspan>');
  });

  it('應用程式負責文字時要求標示並帶入使用者提供的尺寸值', () => {
    const request = buildDraftRequest(intent());
    expect(request).toContain('Traditional Chinese');
    expect(request).toContain('長度 = 120 mm');
  });

  it('生圖模型負責文字或無語言時不要求標示', () => {
    const imageModel = { ...intent(), text: { ...intent().text, renderMode: 'image-model' } } as DrawingIntent;
    expect(buildDraftRequest(imageModel)).toContain('Do NOT include any <text>');
    const none = { ...intent(), textLanguage: 'none' } as DrawingIntent;
    expect(buildDraftRequest(none)).toContain('Do NOT include any <text>');
  });

  it('有標示時生圖提示要求完全不畫文字，且不洩漏標示內容', () => {
    const merged = mergeDraftIntoPrompt('BASE', { svg: '<svg/>', summary: 's', labels: [{ text: 'SECRET-LABEL', x: 0.1, y: 0.1, anchor: 'start', size: 0.02, rotate: 0 }] }, true);
    expect(merged).toContain('Draw NO text at all');
    expect(merged).not.toContain('SECRET-LABEL');
  });

  it('請求帶上圖面類型與單位，讓草稿模型知道要畫什麼', () => {
    const request = buildDraftRequest(intent());
    expect(request).toContain('mechanical-part');
    expect(request).toContain('mm');
    expect(request).toContain('Draft the sheet geometry as SVG');
  });

  it('合併草稿時保留原本骨架，只追加版面依據', () => {
    const merged = mergeDraftIntoPrompt('BASE PROMPT', { svg: '<svg/>', summary: '3 lines' }, true);
    expect(merged.startsWith('BASE PROMPT')).toBe(true);
    expect(merged).toContain('3 lines');
    expect(merged).toContain('first attached image');
  });

  it('沒有附圖時不得宣稱有附圖', () => {
    const merged = mergeDraftIntoPrompt('BASE', { svg: '<svg/>', summary: 's' }, false);
    expect(merged).not.toContain('first attached image');
    expect(merged).toContain('draft summary');
  });
});

describe('systemInstructionFor', () => {
  it('未覆寫時沿用精煉指令，既有行為不變', () => {
    expect(systemInstructionFor({})).toBe(REFINE_SYSTEM_PROMPT);
  });

  it('覆寫時用新指令，並可附加當輪指示', () => {
    expect(systemInstructionFor({ systemPrompt: 'DRAFT', instruction: 'ONLY SVG' })).toBe('DRAFT\n\nONLY SVG');
  });

  it('空白覆寫視為未提供，不會送出空系統指令', () => {
    expect(systemInstructionFor({ systemPrompt: '   ' })).toBe(REFINE_SYSTEM_PROMPT);
  });
});
