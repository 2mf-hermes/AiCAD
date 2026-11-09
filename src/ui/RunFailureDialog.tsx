import { useEffect, useRef } from 'react';
import { useT } from '../i18n';
import { Button } from './primitives';
import './run-failure.css';

interface Props {
  message: string;
  canReuse: boolean;
  canGenerate: boolean;
  onClose: () => void;
  onReuse: () => void;
  onRestart: () => void;
}

/** Native modal provides focus containment, Escape handling and focus restoration. */
export function RunFailureDialog({ message, canReuse, canGenerate, onClose, onReuse, onRestart }: Props) {
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
    <dialog ref={ref} className="utility-dialog run-failure" aria-labelledby="run-failure-title"
      aria-describedby="run-failure-hint" onCancel={(event) => { event.preventDefault(); onClose(); }}>
      <div className="utility-dialog__content">
        <h2 id="run-failure-title" className="utility-dialog__title">{t.generationRetry.title}</h2>
        <p className="utility-dialog__message run-failure__error">{message}</p>
        <p id="run-failure-hint" className="utility-dialog__message">
          {canReuse ? t.generationRetry.savedHint : t.generationRetry.noSavedHint}
        </p>
      </div>
      <div className="utility-dialog__actions run-failure__actions">
        {canReuse && <Button variant="primary" block disabled={!canGenerate} onClick={onReuse}>
          {t.generationRetry.reuse}
        </Button>}
        <Button variant={canReuse ? 'secondary' : 'primary'} block disabled={!canGenerate} onClick={onRestart}>
          {t.generationRetry.restart}
        </Button>
        <Button variant="ghost" block onClick={onClose}>{t.common.cancel}</Button>
      </div>
    </dialog>
  );
}
