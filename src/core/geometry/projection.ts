import { ProjectionCamera, makeProjectedEdges, type Edge, type Shape3D } from 'replicad';
import { emptyEngineeringDocument, type EngineeringDocument, type VectorEntity } from './document';

/** OCCT hidden-line removal; curved non-circular edges use tolerance-bounded polylines. */
export function projectBodies(shapes: { id: string; shape: Shape3D }[], source: EngineeringDocument): EngineeringDocument {
  const doc = emptyEngineeringDocument('2d');
  doc.name = `${source.name} · 2D`; doc.settings = { ...source.settings }; doc.parameters = { ...source.parameters };
  const gap = source.settings.units === 'in' ? 1 : 25;
  let frontWidth = 0, frontHeight = 0;
  for (const plane of ['front', 'top', 'right'] as const) {
    const entities: VectorEntity[] = [];
    const yUp = source.settings.upAxis === 'Y';
    const camera = plane === 'front' ? new ProjectionCamera([0, 0, 0], yUp ? [0, 0, 1] : [0, -1, 0], [1, 0, 0]) : plane === 'top' ? new ProjectionCamera([0, 0, 0], yUp ? [0, 1, 0] : [0, 0, 1], [1, 0, 0]) : new ProjectionCamera([0, 0, 0], [1, 0, 0], yUp ? [0, 0, -1] : [0, 1, 0]);
    try {
      for (const body of shapes) {
        const projected = makeProjectedEdges(body.shape, camera, true);
        try {
          for (const layer of ['visible', 'hidden'] as const) for (const [index, edge] of projected[layer].entries()) {
            const id = `${body.id}.${plane}.${layer}.${index}`;
            const targetLayer = layer === 'visible' ? 'geometry' : 'hidden';
            const point = (t: number) => { const v = edge.pointAt(t); try { return [v.x, v.y] as const; } finally { v.delete(); } };
            const line = (a: readonly number[], b: readonly number[], suffix: string) => entities.push({ id: id + suffix, type: 'line', layer: targetLayer, params: { x1: a[0], y1: a[1], x2: b[0], y2: b[1] } });
            if (edge.geomType === 'LINE') line(point(0), point(1), '');
            else if (edge.geomType === 'CIRCLE' && edge.isClosed) {
              const a = point(0), b = point(0.5); const x = (a[0] + b[0]) / 2, y = (a[1] + b[1]) / 2;
              const radius = Math.hypot(a[0] - x, a[1] - y);
              entities.push({ id, type: 'circle', layer: targetLayer, params: { x, y, radius } });
              if (layer === 'visible') {
                const span = radius * 1.2;
                entities.push({ id: id + '.cx', type: 'line', layer: 'center', params: { x1: x - span, y1: y, x2: x + span, y2: y } }, { id: id + '.cy', type: 'line', layer: 'center', params: { x1: x, y1: y - span, x2: x, y2: y + span } });
              }
            } else {
              const segments = adaptivePoints(edge, source.settings.tolerance);
              for (let n = 1; n < segments.length; n++) line(segments[n - 1], segments[n], `.${n}`);
            }
          }
        } finally { for (const edge of [...projected.visible, ...projected.hidden]) edge.delete(); }
      }
    } finally { camera.delete(); }
    const xs = entities.flatMap(e => e.type === 'line' ? [Number(e.params.x1), Number(e.params.x2)] : [Number(e.params.x) - Number(e.params.radius), Number(e.params.x) + Number(e.params.radius)]);
    const min = Math.min(0, ...xs), max = Math.max(0, ...xs);
    const ys = entities.flatMap(e => e.type === 'line' ? [Number(e.params.y1), Number(e.params.y2)] : [Number(e.params.y) - Number(e.params.radius), Number(e.params.y) + Number(e.params.radius)]);
    const minY = Math.min(0, ...ys), height = Math.max(0, ...ys) - minY, width = max - min;
    const third = source.settings.projection === 'third';
    const offsetX = plane === 'right' ? third ? frontWidth + gap : -width - gap : 0;
    const offsetY = plane === 'top' ? third ? frontHeight + gap : -height - gap : 0;
    if (plane === 'front') { frontWidth = width; frontHeight = height; }
    for (const e of entities) {
      for (const key of e.type === 'line' ? ['x1', 'x2'] : ['x']) e.params[key] = Number(e.params[key]) + offsetX - min;
      for (const key of e.type === 'line' ? ['y1', 'y2'] : ['y']) e.params[key] = Number(e.params[key]) + offsetY - minY;
    }
    doc.entities.push(...entities);
    if (doc.entities.length > 2000) throw new Error('Projection exceeds vector budget; simplify the model or increase tolerance');
  }
  return doc;
}
function adaptivePoints(edge: Edge, tolerance: number): number[][] {
  const at = (t: number) => { const v = edge.pointAt(t); try { return [v.x, v.y]; } finally { v.delete(); } };
  const result = [at(0)];
  const split = (a: number, b: number, pa: number[], pb: number[], depth: number) => {
    const mid = (a + b) / 2, pm = at(mid);
    const error = Math.hypot(pm[0] - (pa[0] + pb[0]) / 2, pm[1] - (pa[1] + pb[1]) / 2);
    if (depth < 12 && error > tolerance) { split(a, mid, pa, pm, depth + 1); split(mid, b, pm, pb, depth + 1); }
    else result.push(pb);
    if (result.length > 2000) throw new Error('Projected curve exceeds complexity budget');
  };
  // Quarter intervals avoid missing symmetric S-curves.
  for (let i = 0; i < 4; i++) split(i / 4, (i + 1) / 4, at(i / 4), at((i + 1) / 4), 0);
  return result;
}
