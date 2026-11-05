/* ============================================================================
   更新摘要 (Update Summary)
   ----------------------------------------------------------------------------
   提示框要的不是整份 release notes，而是「一眼看完」的三欄式摘要：
   新增 / 修改 / 刪除，每項一句話。這個檔案把 release notes（Markdown）
   壓縮成那個形狀。

   設計取捨（寧可保守，也不要亂猜）：
   - 條列（- * + • 1.）才算「項目」；段落、標題、引用、水平線、純連結全部
     忽略。理由：release notes 的「重點」幾乎都寫成條列；把敘述段落塞進
     提示框，只是回到「詳細更新內容」的老路。
   - 「下載 / Download / SHA256 / Asset」等章節整節跳過 —— 那是檔案清單，
     不是更新內容。
   - 每項只取第一個子句（。；—— 之前），上限 MAX_LEN 字，超過就刪節。
   - 開頭的分類詞（「新增：」「Added:」…）用來歸類；歸類詞從句子剝掉，
     讓「新增」欄裡的每一項讀起來就是純項目。
   - 歸不出類的條列一律算「修改」：誠實 —— 絕大多數條列講的就是行為變更。
   - 雙語 notes：zh 與 en 條列同時存在時，只保留 UI 偏好語言那側，
     避免同一件事在提示框裡出現兩次。
   - 純字串處理、無副作用：任何輸入（null、亂碼、空字串）都得到
     { empty: true }，絕不丟例外 —— 提示框寧可顯示通用 fallback。
   ========================================================================== */

export type UpdateChangeKind = 'added' | 'changed' | 'removed';

export interface UpdateSummaryGroup {
  kind: UpdateChangeKind;
  items: string[];
}

export interface UpdateSummary {
  /** added → changed → removed，只保留非空組 */
  groups: UpdateSummaryGroup[];
  /** true = notes 擠不出任何條列項；UI 應顯示通用 fallback 文案 */
  empty: boolean;
}

/** UI 語言偏好：條列同時含中／英時，保留哪一側 */
export type SummaryScript = 'cjk' | 'latin';

const MAX_LEN = 60;

/** CJK 範圍：漢字（含擴充）、假名、諺文、CJK 標點 */
const CJK_RE =
  /[\u3000-\u303f\u3040-\u30ff\u3130-\u318f\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uf900-\ufaff]/;

/** 這些「章節」講的是檔案與雜湊，不是更新內容 —— 整節跳過 */
const SKIP_SECTION_RE =
  /(下載|下载|安裝|安装|install|download|checksum|sha-?256|雜湊|哈希|hash|re-?download|asset|attachment)/i;

/** 條列符：- * + • 、1. 1) 1、 */
const BULLET_RE = /^\s*(?:[-*+•]|\d{1,3}\s*[.)、])\s+(.+)$/;

/** 標題：# 開頭，或整行粗體（GitHub notes 常用 **X** 當小節） */
const HEADING_RE = /^\s*(?:#{1,6}\s+.*|\*\*[^*]+\*\*\s*:?|==+|--+)$/;

/** 純連結條列（- https://…） */
const LINK_ITEM_RE = /^(?:https?:\/\/|<)/i;

/* ---------------------------------------------------------------------------
   分類詞。CJK 詞要求後面接冒號或空白（「刪除：」/「刪除 舊」），
   避免把「刪除線」這種詞誤剝。拉丁詞用 \b 擋住 newly / removal 之類。
   ------------------------------------------------------------------------- */
const REMOVED_RE =
  /^(?:(?:刪除|移除)(?:\s*[:：]\s*|\s+)|(?:remove[ds]?|delete[ds]?|dropped)\b\s*:?\s*)/i;
const ADDED_RE =
  /^(?:(?:新增|加入)(?:\s*[:：]\s*|\s+)|(?:add(?:ed|s)?|new)\b\s*:?\s*)/i;
/* 修改類詞：有冒號才剝（「修正：X」→「X」）；「修正 X」保留原句讀起來較自然 */
const CHANGED_LABEL_RE =
  /^(?:修改|變更|变更|調整|调整|優化|优化|改善|修正|更新|fix(?:ed|es)?|chang(?:ed|es)?|modif(?:y|ied)|improv(?:e|ed|es)?|updat(?:e|ed|es)?|adjust(?:ed)?|optimiz(?:e|ed)?|refactor(?:ed)?|renam(?:e|ed)?|reorder(?:ed)?)\s*[:：]\s*/i;

/** 條列裡的雜訊：檔案資產、雜湊條 */
const NOISE_RE = /^(?:aicad\.exe|sha256sums?\.txt|sha-?256\s*[:=]?|checksum\s*[:=]?)/i;

/* ---------------------------------------------------------------------------
   Markdown 裝飾剝除：圖片、連結、粗斜體、行內碼、殘餘標籤
   ------------------------------------------------------------------------- */
function stripMarkdown(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')          // ![alt](url)
    .replace(/\[([^\]]*)\]\(([^)]*)\)/g, '$1')      // [text](url) → text
    .replace(/\*\*([^*]+)\*\*/g, '$1')              // **bold**
    .replace(/__([^_]+)__/g, '$1')                  // __bold__
    .replace(/`([^`]+)`/g, '$1')                    // `code`
    .replace(/\*([^*]+)\*/g, '$1')                  // *italic*
    .replace(/\s+/g, ' ')                           // 摺疊斷行/多餘空白
    .trim();
}

/** 取第一個子句：。；—— — 為界；冒號（前綴 ≥6 字）也是「標題：細節」的界 */
function firstClause(text: string): string {
  const boundaries: number[] = [];
  const push = (re: RegExp, min = 0) => {
    const m = re.exec(text);
    if (m && m.index >= min) boundaries.push(m.index);
  };
  push(/[。；;]/);
  push(/——/);
  push(/(?:\s—\s)/);
  push(/[:：]/, 6);
  const cut = boundaries.length ? Math.min(...boundaries) : -1;
  return (cut >= 0 ? text.slice(0, cut) : text).replace(/[\s。，,、;；:：]+$/, '');
}

/** 超長刪節：盡量斷在標點/空白，斷不出合理位置就直接截斷 */
function truncate(text: string): string {
  if (text.length <= MAX_LEN) return text;
  const head = text.slice(0, MAX_LEN);
  const at = Math.max(
    head.lastIndexOf('，'), head.lastIndexOf('、'),
    head.lastIndexOf(','), head.lastIndexOf(' '),
  );
  return (at > 24 ? head.slice(0, at + 1) : head).trimEnd() + '…';
}

function classify(raw: string): { kind: UpdateChangeKind; text: string } {
  let text = raw;
  let kind: UpdateChangeKind = 'changed';
  const removed = REMOVED_RE.exec(text);
  if (removed) { kind = 'removed'; text = text.slice(removed[0].length); }
  else {
    const added = ADDED_RE.exec(text);
    if (added) { kind = 'added'; text = text.slice(added[0].length); }
    else { text = text.replace(CHANGED_LABEL_RE, ''); }
  }
  return { kind, text: text.trim() };
}

/**
 * 把 release notes 壓縮成「新增／修改／刪除」三欄摘要。
 * 任何輸入都不丟例外；擠不出條列 → { empty: true }。
 */
export function summarizeUpdateNotes(
  notes: unknown,
  prefer: SummaryScript = 'latin',
): UpdateSummary {
  if (typeof notes !== 'string' || !notes.trim()) return { groups: [], empty: true };

  type Row = { kind: UpdateChangeKind; text: string; cjk: boolean };
  const rows: Row[] = [];

  let skip = false; // 目前是否在「下載」類章節內
  for (const line of notes.split(/\r?\n/)) {
    if (HEADING_RE.test(line)) {
      skip = SKIP_SECTION_RE.test(line);
      continue;
    }
    if (/^\s*>/.test(line)) continue;          // 引用（re-download 提示）
    const m = BULLET_RE.exec(line);
    if (!m) continue;                          // 段落、空行 → 忽略
    if (skip) continue;
    const cleaned = stripMarkdown(m[1]);
    if (!cleaned || LINK_ITEM_RE.test(cleaned) || NOISE_RE.test(cleaned)) continue;
    const { kind, text } = classify(cleaned);
    if (!text) continue;
    rows.push({ kind, text: truncate(firstClause(text)), cjk: CJK_RE.test(cleaned) });
  }

  /* 雙語 notes：兩種文字系統都有條列 → 只留 UI 偏好側 */
  const hasCjk = rows.some((r) => r.cjk);
  const hasLatin = rows.some((r) => !r.cjk);
  let picked = rows;
  if (hasCjk && hasLatin) {
    const want = prefer === 'cjk';
    const filtered = rows.filter((r) => r.cjk === want);
    if (filtered.length) picked = filtered;    // 偏好側為空才退回另一側
  }

  /* 去重 + 按欄分組 */
  const order: UpdateChangeKind[] = ['added', 'changed', 'removed'];
  const groups: UpdateSummaryGroup[] = [];
  for (const kind of order) {
    const seen = new Set<string>();
    const items: string[] = [];
    for (const r of picked) {
      if (r.kind !== kind || seen.has(r.text)) continue;
      seen.add(r.text);
      items.push(r.text);
    }
    if (items.length) groups.push({ kind, items });
  }

  return { groups, empty: groups.length === 0 };
}
