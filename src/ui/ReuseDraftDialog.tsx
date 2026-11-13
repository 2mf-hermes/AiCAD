import { useEffect, useRef } from 'react';
import { useT } from '../i18n';
import { Button } from './primitives';
import './run-failure.css';

interface Props {
  onClose: () => void;
  /** 沿用：精煉過的提示詞與草稿直接送生圖模型。 */
  onReuse: () => void;
  /** 重新精煉：文字模型再跑一次並產出新的參考草稿。 */
  onRefine: () => void;
}

/**
 * 第二次生圖前的選擇：上次的精煉提示詞與草稿還在，讓使用者決定要不要再用一次。
 * 沿用可以省掉文字模型的兩段（精煉＋草稿），重新精煉則是完整重跑。
 * 沿用 RunFailureDialog 的原生 dialog 慣例：焦點收束、Esc、焦點還原都由瀏覽器處理。
 */
export function ReuseDraftDialog({ onClose, onReuse, onRefine }: Props) {
  const t = useT();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

  return (
    <dialog ref={ref} className="utility-dialog run-failure" aria-labelledby="reuse-draft-title"
      aria-describedby="reuse-draft-hint" onCancel={(event) => { event.preventDefault(); onClose(); }}>
      <div className="utility-dialog__content">
        <h2 id="reuse-draft-title" className="utility-dialog__title">{t.reuseDraft.title}</h2>
        <p id="reuse-draft-hint" className="utility-dialog__message">{t.reuseDraft.savedHint}</p>
      </div>
      <div className="utility-dialog__actions run-failure__actions">
        <Button variant="primary" block onClick={onReuse}>{t.reuseDraft.reuse}</Button>
        <Button variant="secondary" block onClick={onRefine}>{t.reuseDraft.refine}</Button>
        <Button variant="ghost" block onClick={onClose}>{t.common.cancel}</Button>
      </div>
    </dialog>
  );
}
