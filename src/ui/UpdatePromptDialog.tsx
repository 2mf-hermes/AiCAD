/* ============================================================================
   更新提示框 (Update Prompt)
   ----------------------------------------------------------------------------
   使用者要求：提示內容要少。這裡只留兩件事 ——
     1) 有新版本（版本號）
     2) 一句話說明可以更新到最新功能與錯誤修復

   詳細變更內容不在提示框出現；想看細節請到「設定 → 更新」，
   或直接看 GitHub Release 頁面。
   ========================================================================== */

import { useEffect } from 'react';
import { useT } from '../i18n';
import { Button } from './primitives';
import './update-prompt.css';

export interface UpdatePromptDialogProps {
  /** 新版本號，用於標題 */
  version: string;
  /** 使用者按「稍後再說」或點背景關閉 */
  onLater: () => void;
  /** 使用者按主要按鈕：前往「設定 → 更新」 */
  onGoToUpdate: () => void;
}

export function UpdatePromptDialog({ version, onLater, onGoToUpdate }: UpdatePromptDialogProps) {
  const t = useT();

  /* Esc = 稍後再說。桌面對話框的基本頁盤契約 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onLater();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onLater]);

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
            {t.update.promptTitle(version)}
          </h2>
          <p id="update-prompt-intro" className="utility-dialog__message">
            {t.update.promptHint}
          </p>
        </div>

        <div className="utility-dialog__actions">
          <Button variant="secondary" onClick={onLater}>
            {t.update.later}
          </Button>
          <Button variant="primary" onClick={onGoToUpdate}>
            {t.update.goToUpdate}
          </Button>
        </div>
      </section>
    </div>
  );
}
