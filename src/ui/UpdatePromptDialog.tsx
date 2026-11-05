/* ============================================================================
   更新提示框 (Update Prompt)
   ----------------------------------------------------------------------------
   使用者明確要求：檢查到更新時，不要用現在的方式顯示詳細更新內容，
   改用提示框，內容只要「基本簡單的新增／修改／刪除」項目。

   所以這個元件的職責很窄：把 release notes（可能是幾百字的 Markdown）
   壓成「一眼看完」的三欄式摘要，其餘一律不顯示。摘要邏輯不在這裡 ——
   它在 core/updateSummary.ts，是純字串處理、可單元測試；這裡只負責排版。

   兩處會用到它（所以獨立成檔，不塞在 SettingsSheet 裡）：
     - 設定 → 更新：手動檢查到新版本時
     - 開機自動檢查（App.tsx，settings.updates.autoCheck）

   為什麼不用原生 confirm()：原生對話框在 WebView2 裡是另一個視窗，
   樣式與 App 完全脫節，也塞不進三欄摘要。utility-dialog 是 App 既有
   的對話框語彙（z-120 背板），視覺與行為都一致。
   ========================================================================== */

import { useEffect, useMemo, useState } from 'react';
import { useLocale, useT } from '../i18n';
import { summarizeUpdateNotes, type UpdateChangeKind, type UpdateSummaryGroup } from '../core/updateSummary';
import { Button } from './primitives';
import './update-prompt.css';

const ORDER: UpdateChangeKind[] = ['added', 'changed', 'removed'];

/** notes 可能是任何東西（宿主回傳、舊版格式）；解析器保證不丟例外 */
function labelFor(kind: UpdateChangeKind, t: ReturnType<typeof useT>): string {
  if (kind === 'added') return t.update.itemAdded;
  if (kind === 'removed') return t.update.itemRemoved;
  return t.update.itemChanged;
}

export interface UpdatePromptDialogProps {
  /** 新版本號，用於標題 */
  version: string;
  /** 該版本的 release notes（Markdown 純文字） */
  notes: string;
  /** 使用者按下「稍後再說」或關閉提示框 */
  onLater: () => void;
  /** 使用者按下「重試」——再檢查一次 */
  onRetry: () => void;
}

export function UpdatePromptDialog({ version, notes, onLater, onRetry }: UpdatePromptDialogProps) {
  const t = useT();
  const locale = useLocale();

  /* 雙語 notes：跟隨 UI 語言取那一側，避免同一件事出現兩次 */
  const prefer = locale === 'en' ? 'latin' : 'cjk';

  const [expanded, setExpanded] = useState(false);
  const summary = useMemo(() => summarizeUpdateNotes(notes, prefer), [notes, prefer]);
  const groups: UpdateSummaryGroup[] = summary.groups;

  /* 換一個版本就重新折疊：提示框是「一眼看完」，不該繼承上一次的展開狀態 */
  useEffect(() => {
    setExpanded(false);
  }, [version, notes]);

  /* Esc = 稍後再說。桌面對話框的基本鍵盤契約 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onLater();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onLater]);

  /* 條目很多時先只顯示前幾項，其餘收在「顯示全部」後面 —— 這是為了
     「基本簡單」：一登上來就二十列同樣違背初衷。展開後才是完整清單。 */
  const PREVIEW = 4;
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  const hidden = expanded ? 0 : Math.max(0, total - PREVIEW);

  return (
    <div className="utility-dialog-backdrop" role="presentation" onMouseDown={onLater}>
      <section
        className="utility-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-prompt-title"
        aria-describedby="update-prompt-intro"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="utility-dialog__content">
          <h2 id="update-prompt-title" className="utility-dialog__title">
            {t.update.found(version)}
          </h2>
          <p id="update-prompt-intro" className="utility-dialog__message">
            {t.update.promptIntro}
          </p>

          {summary.empty ? (
            /* notes 解析不出條列（純段落、只有下載說明、或根本沒有 notes）。
               寧可顯示一句通用說明，也不把原始長文本倒出來 —— 那就回到老路。 */
            <p className="update-prompt__empty">{t.update.promptEmpty}</p>
          ) : (
            <div className="update-prompt__groups">
              {ORDER.map((kind) => {
                const group = groups.find((g) => g.kind === kind);
                if (!group || group.items.length === 0) return null;
                const shown = expanded ? group.items : group.items.slice(0, PREVIEW);
                const groupHidden = group.items.length - shown.length;
                return (
                  <div className="update-prompt__group" key={kind}>
                    <span className="update-prompt__label">{labelFor(kind, t)}</span>
                    <ul className="update-prompt__list">
                      {shown.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                      {groupHidden > 0 && (
                        <li className="update-prompt__more">+{groupHidden}</li>
                      )}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}

          {!summary.empty && hidden > 0 && (
            <button
              type="button"
              className="update-prompt__expand"
              onClick={() => setExpanded(true)}
            >
              {expanded ? '' : `+${hidden}`}
            </button>
          )}
        </div>

        <div className="utility-dialog__actions">
          <Button variant="secondary" onClick={onLater}>
            {t.update.later}
          </Button>
          <Button variant="primary" onClick={onRetry}>
            {t.update.retry}
          </Button>
        </div>
      </section>
    </div>
  );
}
