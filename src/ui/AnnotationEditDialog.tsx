/* ============================================================================
   「修改標註」對話框（Annotation Edit Dialog）
   ----------------------------------------------------------------------------
   使用者的實際流程是「先產圖 → 再看圖面哪裡缺標註」。標註開關若只能在產圖前調，
   每一次微調都得重新生成一張圖 —— 但標註本來就是應用程式事後疊上去的圖層，
   重新跑生圖模型對結果毫無幫助，只是浪費時間與額度。

   所以這裡把同一組開關搬到產圖之後：對話框直接改「目前這張圖」的 intent，
   圖面重繪後立即反映。開關本身即時生效，沒有「套用」按鈕要按，
   關閉對話框就是確認。

   顯示邏輯刻意跟著 annotationRows()：那支函式才是真正決定圖面上疊什麼的地方，
   對話框顯示的項數必須和它一致，否則使用者會看到對不上的數字。
   ========================================================================== */

import { useEffect, useMemo, useRef } from 'react';
import { useT } from '../i18n';
import { annotationRows } from '../core/annotationOverlay';
import type { DrawingIntent, DrawingTextRenderMode } from '../core/types';
import { Button, Field, Select, Toggle } from './primitives';
import './utility-dialog.css';
import './annotation-edit.css';

interface Props {
  /** 目前檢視中的圖面（含它自己的 intent）——改的是這一份，不是左欄的待產圖設定。 */
  intent: DrawingIntent;
  onChange: (next: DrawingIntent) => void;
  onClose: () => void;
}

export function AnnotationEditDialog({ intent, onChange, onClose }: Props) {
  const t = useT();
  const ref = useRef<HTMLDialogElement>(null);

  /* 原生 <dialog> 提供焦點圍籬、Esc 關閉與焦點還原，不必自己實作。 */
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

  const patchAnnotation = (delta: Partial<DrawingIntent['annotation']>) =>
    onChange({ ...intent, annotation: { ...intent.annotation, ...delta } });
  const patchText = (delta: Partial<DrawingIntent['text']>) =>
    onChange({ ...intent, text: { ...intent.text, ...delta } });

  const rowCount = useMemo(() => annotationRows(intent).length, [intent]);
  const overlayCount = rowCount + (intent.annotation.titleBlock ? 1 : 0) + (intent.annotation.scaleBar ? 1 : 0);
  const byModel = intent.text.renderMode !== 'application';
  const summary = byModel
    ? t.intent.annotationEditByModel
    : overlayCount > 0
      ? t.intent.annotationEditRows(overlayCount)
      : t.intent.annotationEditNone;

  const turnAllOff = () =>
    patchAnnotation({ dimensions: false, tolerance: false, gdt: false, callouts: false, titleBlock: false, scaleBar: false });

  return (
    <dialog
      ref={ref}
      className="utility-dialog annotation-edit"
      aria-labelledby="annotation-edit-title"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
    >
      <div className="utility-dialog__content">
        <h2 id="annotation-edit-title" className="utility-dialog__title">{t.intent.annotationEditTitle}</h2>
        <p className="utility-dialog__message">{t.intent.annotationEditHint}</p>
        <Field label={t.intent.textRenderMode}>
          <Select<DrawingTextRenderMode>
            ariaLabel={t.intent.textRenderMode}
            value={intent.text.renderMode}
            onChange={(renderMode) => patchText({ renderMode })}
            options={[
              { value: 'application', label: t.intent.textRenderApplication },
              { value: 'image-model', label: t.intent.textRenderImageModel },
            ]}
          />
        </Field>
        <div className="annotation-edit__list">
          <Toggle
            label={t.intent.dimensions}
            description={t.intent.dimensionsHint}
            checked={intent.annotation.dimensions}
            onChange={(dimensions) => patchAnnotation({ dimensions })}
          />
          <Toggle
            label={t.intent.tolerance}
            description={t.intent.toleranceHint}
            checked={intent.annotation.tolerance}
            onChange={(tolerance) => patchAnnotation({ tolerance })}
          />
          <Toggle
            label={t.intent.gdt}
            description={t.intent.gdtHint}
            checked={intent.annotation.gdt}
            onChange={(gdt) => patchAnnotation({ gdt })}
          />
          <Toggle
            label={t.intent.callouts}
            checked={intent.annotation.callouts}
            onChange={(callouts) => patchAnnotation({ callouts })}
          />
          <Toggle
            label={t.intent.titleBlock}
            description={t.intent.titleBlockHint}
            checked={intent.annotation.titleBlock}
            onChange={(titleBlock) => patchAnnotation({ titleBlock })}
          />
          <Toggle
            label={t.intent.scaleBar}
            description={t.intent.scaleBarHint}
            checked={intent.annotation.scaleBar}
            onChange={(scaleBar) => patchAnnotation({ scaleBar })}
          />
        </div>
        <p className="annotation-edit__summary">{summary}</p>
      </div>
      <div className="utility-dialog__actions">
        <Button variant="ghost" onClick={turnAllOff}>{t.intent.annotationEditAllOff}</Button>
        <Button variant="primary" onClick={onClose}>{t.common.done}</Button>
      </div>
    </dialog>
  );
}
