import { useRef, useState } from 'react';
import { vectorBounds, vectorElement } from '../core/geometry/vector';
import type { EngineeringDocument } from '../core/geometry/document';
export function VectorViewport({ document: doc, selected, onSelect }: { document: EngineeringDocument; selected: string[]; onSelect: (id: string, additive: boolean) => void }) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number } | null>(null);
  const moved = useRef(false);
  const [x, y, w, h] = vectorBounds(doc);
  const vb = [x + w * (1 - 1 / zoom) / 2 + pan.x, y + h * (1 - 1 / zoom) / 2 + pan.y, w / zoom, h / zoom];
  return <svg className="geometry-vector" aria-label="2D 向量圖面" viewBox={vb.join(' ')}
    onWheel={e => setZoom(old => Math.min(20, Math.max(0.2, old * (e.deltaY < 0 ? 1.15 : 1 / 1.15))))}
    onDoubleClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}
    onPointerDown={e => { moved.current = false; if (e.button === 1 || e.shiftKey) { e.preventDefault(); drag.current = { x: e.clientX, y: e.clientY }; e.currentTarget.setPointerCapture(e.pointerId); } }}
    onPointerMove={e => { if (!drag.current) return; const matrix = e.currentTarget.getScreenCTM(); if (!matrix) return; const inverse = matrix.inverse(); const previous = new DOMPoint(drag.current.x, drag.current.y).matrixTransform(inverse); const current = new DOMPoint(e.clientX, e.clientY).matrixTransform(inverse); setPan(old => ({ x: old.x - current.x + previous.x, y: old.y - current.y + previous.y })); drag.current = { x: e.clientX, y: e.clientY }; moved.current = true; }}
    onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
    onClick={() => { if (!moved.current) onSelect('', false); }}>
    {doc.entities.map(entity => <g key={entity.id} data-entity-id={entity.id} className={selected.includes(entity.id) ? 'is-selected' : ''} fill="none" stroke="currentColor"
      onClick={e => { e.stopPropagation(); if (!moved.current && !e.shiftKey) onSelect(entity.id, e.ctrlKey || e.metaKey); }}>
      <g strokeWidth={Math.max(w, h) / 800} style={{ color: entity.layer === 'center' ? 'var(--dim-line)' : undefined, strokeDasharray: entity.layer === 'hidden' ? '2 1' : entity.layer === 'center' ? '4 1 1 1' : undefined }} dangerouslySetInnerHTML={{ __html: vectorElement(entity, doc) }} />
      {entity.type !== 'text' && <g stroke="transparent" strokeWidth={8} style={{ pointerEvents: 'stroke' }} dangerouslySetInnerHTML={{ __html: vectorElement(entity, doc).replace(/\/>/g, ' vector-effect="non-scaling-stroke"/>') }} />}
    </g>)}
  </svg>;
}
