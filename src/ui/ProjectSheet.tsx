import type { ProjectMeta } from '../core/projects';
import { useT } from '../i18n';
import { IconClose } from './icons';
import { Button } from './primitives';

export function ProjectSheet({ projects, busy, onOpen, onDelete, onClose }: {
  projects: ProjectMeta[];
  busy: boolean;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  return (
    <div className="sheet-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className="project-sheet" role="dialog" aria-modal="true" aria-label={t.project.openTitle}>
        <header className="project-sheet__head">
          <div><h2>{t.project.openTitle}</h2><p>{t.project.openHint}</p></div>
          <button className="iconbtn" type="button" aria-label={t.common.close} onClick={onClose}><IconClose size={16} /></button>
        </header>
        <div className="project-list">
          {projects.length === 0 ? <p className="empty-note">{t.project.empty}</p> : projects.map((project) => (
            <article className="project-row" key={project.id}>
              <button type="button" className="project-row__open" disabled={busy} onClick={() => onOpen(project.id)}>
                <span className="project-row__preview">{project.preview ? <img src={project.preview} alt="" /> : <span>AI</span>}</span>
                <span className="project-row__copy">
                  <strong>{project.name}</strong>
                  <small>{t.project.meta(new Date(project.updatedAt).toLocaleString(), project.boards)}</small>
                </span>
              </button>
              <Button variant="ghost" disabled={busy} onClick={() => onDelete(project.id)}>{t.common.remove}</Button>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
