/* 更新摘要：release notes →「新增／修改／刪除」三欄條列的壓縮測試。
   fixture 刻意貼齊 AiCad 實際的雙語 release notes 形狀（v0.2.0）。 */
import { describe, expect, it } from 'vitest';
import { summarizeUpdateNotes } from './updateSummary';

/* 真實 v0.2.0 notes（縮編）：zh 條列 + en 段落 + 下載章 + 引用提示 */
const V020_NOTES = `AiCad 0.2.0

## 重點：畫面文字改由「草稿標註 → 程式補回」流程

- 文字模型擬 SVG 草稿時，一併以 <text> 標出文字的位置、對齊、字距與旋轉。
- 送給生圖模型的參考草圖會剝除全部文字；模型只需專心畫線條。
- 生成後由程式依草稿座標把文字補回：支援 CJK 字型、藍圖／白圖兩種配色。
- 標示獨立於底圖：局部重繪（inpaint）不會毀掉或重複文字。
- 『生圖模型畫字』模式、關閉圖面文字語言、舊專案與舊存檔維持原行為，完全向下相容。

## English

Drafting now asks the text model to label every caption with <text> elements; the image model receives a text-free draft, and the application renders crisp labels back on the finished drawing.

## 下載 / Download

- AiCad.exe
- SHA256SUMS.txt

> **v0.1.x 的使用者：** 請重新下載
`;

describe('summarizeUpdateNotes — 真實 notes 形狀', () => {
  it('zh 偏好：5 條全歸「修改」，下載條列、en 段落、引用提示都不出現', () => {
    const s = summarizeUpdateNotes(V020_NOTES, 'cjk');
    expect(s.empty).toBe(false);
    expect(s.groups).toHaveLength(1);
    expect(s.groups[0].kind).toBe('changed');
    expect(s.groups[0].items).toHaveLength(5);
    expect(s.groups[0].items[1]).toBe('送給生圖模型的參考草圖會剝除全部文字');
    // 冒號後的細節被切掉，只留主句
    expect(s.groups[0].items[2]).toBe('生成後由程式依草稿座標把文字補回');
    expect(s.groups[0].items[3]).toBe('標示獨立於底圖');
    // 條列裡 <text>、『』 原樣保留；條列裡的 HTML 標籤剝除
    expect(s.groups[0].items[0]).toContain('<text>');
    for (const item of s.groups[0].items) {
      expect(item).not.toMatch(/AiCad\.exe|SHA256SUMS|English|drafting/i);
    }
  });

  it('latin 偏好：en 沒有條列 → 退回 zh 條列（寧可顯示，不要空白）', () => {
    const s = summarizeUpdateNotes(V020_NOTES, 'latin');
    expect(s.groups[0].kind).toBe('changed');
    expect(s.groups[0].items).toHaveLength(5);
    expect(s.groups[0].items[0]).toContain('SVG');
  });

  it('雙側都有條列 → 只留偏好側', () => {
    const notes = [
      '## 中文',
      '- 新增：圖層鎖點',
      '## English',
      '- Added: layer snapping',
      '- Fixed: crash on open',
    ].join('\n');
    expect(summarizeUpdateNotes(notes, 'cjk').groups).toEqual([
      { kind: 'added', items: ['圖層鎖點'] },
    ]);
    const en = summarizeUpdateNotes(notes, 'latin');
    expect(en.groups).toEqual([
      { kind: 'added', items: ['layer snapping'] },
      { kind: 'changed', items: ['crash on open'] },
    ]);
  });
});

describe('summarizeUpdateNotes — 分類', () => {
  const bullets = (xs: string[]) => xs.map((x) => `- ${x}`).join('\n');

  it('Added/Removed/新增：/刪除：歸對欄，且歸類詞剝掉（CJK 側）', () => {
    const s = summarizeUpdateNotes(bullets([
      '新增：圖層鎖點',
      '刪除：舊版 .aic 匯入',
      '修正：開啟舊檔崩潰',
    ]), 'cjk');
    expect(s.groups).toEqual([
      { kind: 'added', items: ['圖層鎖點'] },
      { kind: 'changed', items: ['開啟舊檔崩潰'] },
      { kind: 'removed', items: ['舊版 .aic 匯入'] },
    ]);
  });

  it('Added/Removed/Fixed（latin 側）', () => {
    const s = summarizeUpdateNotes(bullets([
      'Added: layer snapping',
      'Removed legacy .aic file import',
      'Fixed: crash on open',
    ]), 'latin');
    expect(s.groups).toEqual([
      { kind: 'added', items: ['layer snapping'] },
      { kind: 'changed', items: ['crash on open'] },
      { kind: 'removed', items: ['legacy .aic file import'] },
    ]);
  });

  it('「刪除線」這種詞（無冒號/空白）不被誤剝', () => {
    const s = summarizeUpdateNotes(bullets(['刪除線樣式']), 'cjk');
    expect(s.groups[0]).toEqual({ kind: 'changed', items: ['刪除線樣式'] });
  });

  it('newly 開頭（\b 邊界）不誤歸「新增」', () => {
    const s = summarizeUpdateNotes(bullets(['newly tuned snapping tolerance']), 'latin');
    expect(s.groups[0]).toEqual({ kind: 'changed', items: ['newly tuned snapping tolerance'] });
  });

  it('「修正：」冒號剝掉，「修正 X」保留原句', () => {
    const s = summarizeUpdateNotes(bullets(['修正：開啟舊檔崩潰', '修正 開啟舊檔崩潰']), 'cjk');
    expect(s.groups[0].items).toEqual(['開啟舊檔崩潰', '修正 開啟舊檔崩潰']);
  });
});

describe('summarizeUpdateNotes — 簡化', () => {
  it('；、。 — 之後的細節切掉；前綴 <6 字的冒號（Note:）不切', () => {
    const s = summarizeUpdateNotes([
      '- 標示獨立於底圖；局部重繪不會毀掉文字',
      '- Note: 10:30 釋出的 hotfix',
    ].join('\n'), 'cjk');
    expect(s.groups[0].items).toEqual(['標示獨立於底圖', 'Note: 10:30 釋出的 hotfix']);
  });

  it('超過 60 字 → 斷在標點後刪節', () => {
    const long = 'A'.repeat(30) + '，' + 'B'.repeat(40);
    const s = summarizeUpdateNotes(`- ${long}`, 'cjk');
    expect(s.groups[0].items[0]).toBe('A'.repeat(30) + '，…');
  });

  it('粗體/行內碼/連結 markdown 剝除，條列裡 HTML 標籤剝除', () => {
    const s = summarizeUpdateNotes('- **[新繪圖引擎](https://x.y)** `<text>`', 'latin');
    expect(s.groups[0].items[0]).toBe('新繪圖引擎 <text>');
  });

  it('純連結條列與 SHA256SUMS 條列（章節外）也濾掉', () => {
    const s = summarizeUpdateNotes('- https://example.com/x\n- SHA256SUMS.txt\n- 真正的條列', 'cjk');
    expect(s.groups[0].items).toEqual(['真正的條列']);
  });

  it('相同條列去重', () => {
    const s = summarizeUpdateNotes('- 同一件事\n- 同一件事', 'cjk');
    expect(s.groups[0].items).toEqual(['同一件事']);
  });

  it('1. 2.）數字條列也算', () => {
    const s = summarizeUpdateNotes('1. 第一項\n2) 第二項', 'cjk');
    expect(s.groups[0].items).toEqual(['第一項', '第二項']);
  });
});

describe('summarizeUpdateNotes — 防禦', () => {
  it('null / undefined / 空字串 / 純標題 → empty', () => {
    for (const v of [null, undefined, '', '   ', '# AiCad 0.2.0\n> 說明']) {
      const s = summarizeUpdateNotes(v, 'cjk');
      expect(s.empty).toBe(true);
      expect(s.groups).toEqual([]);
    }
  });

  it('「## Download」章節條列整節跳過，下一節恢復', () => {
    const notes = [
      '## Download',
      '- AiCad.exe',
      '## Fixes',
      '- Fixed: crash on open',
    ].join('\n');
    const s = summarizeUpdateNotes(notes, 'latin');
    expect(s.groups[0].items).toEqual(['crash on open']);
  });

  it('**粗體小節** 當標題，觸發「Asset」跳章；下一節恢復', () => {
    const notes = ['**Assets updated**', '- SHA256SUMS.txt', '## Fixes', '- Fixed: crash'].join('\n');
    const s = summarizeUpdateNotes(notes, 'latin');
    expect(s.groups[0].items).toEqual(['crash']);
  });
});
