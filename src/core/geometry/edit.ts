import { resolveScalar, type EngineeringDocument, type VectorEntity } from './document';
import { vectorNumbers } from './vector';
export function transformVectors(doc: EngineeringDocument, selected: string[], operation: 'rotate' | 'mirrorX' | 'mirrorY', cx: number, cy: number, angle = 0): EngineeringDocument {
  if (![cx, cy, angle].every(Number.isFinite)) throw new Error('基準點與角度必須為有效數字');
  if (!doc.entities.some(entity => selected.includes(entity.id))) throw new Error('請先選取實體');
  const radians = angle * Math.PI / 180;
  const point = (x: number, y: number): [number, number] => operation === 'rotate'
    ? [cx + (x - cx) * Math.cos(radians) - (y - cy) * Math.sin(radians), cy + (x - cx) * Math.sin(radians) + (y - cy) * Math.cos(radians)]
    : operation === 'mirrorX' ? [x, 2 * cy - y] : [2 * cx - x, y];
  const next = structuredClone(doc);
  next.entities = doc.entities.flatMap(entity => {
    if (!selected.includes(entity.id)) return [structuredClone(entity)];
    if (entity.type === 'text') throw new Error('請分開選取幾何輪廓；文字暫不支援旋轉或鏡射');
    const p = vectorNumbers(entity, doc);
    const copy = structuredClone(entity);
    if (entity.type === 'rect') {
      const corners = [[p.x, p.y], [p.x + p.width, p.y], [p.x + p.width, p.y + p.height], [p.x, p.y + p.height]].map(([x, y]) => point(x, y));
      if (operation === 'rotate') return corners.map(([x1, y1], index) => {
        const [x2, y2] = corners[(index + 1) % 4];
        return { id: index === 0 ? entity.id : crypto.randomUUID(), layer: entity.layer, type: 'line' as const, params: { x1, y1, x2, y2 } };
      });
      copy.params.x = Math.min(...corners.map(corner => corner[0]));
      copy.params.y = Math.min(...corners.map(corner => corner[1]));
    } else if (entity.type === 'line') {
      [copy.params.x1, copy.params.y1] = point(p.x1, p.y1);
      [copy.params.x2, copy.params.y2] = point(p.x2, p.y2);
    } else {
      [copy.params.x, copy.params.y] = point(p.x, p.y);
      if (entity.type === 'arc') {
        const direction = (value: number) => operation === 'rotate' ? value + angle : operation === 'mirrorX' ? -value : 180 - value;
        copy.params.startAngle = direction(operation === 'rotate' ? p.startAngle : p.endAngle);
        copy.params.endAngle = direction(operation === 'rotate' ? p.endAngle : p.startAngle);
      }
    }
    vectorNumbers(copy, doc);
    return [copy];
  });
  if (next.entities.length > 2000) throw new Error('轉換超過實體上限');
  return next;
}
/** Positive distances offset lines to their left and enlarge closed profiles. */
export function offsetVector(entity: VectorEntity, doc: EngineeringDocument, distance: number): VectorEntity {
  if (!Number.isFinite(distance) || distance === 0) throw new Error('偏移距離必須為非零有限數字');
  const p = vectorNumbers(entity, doc);
  const next = structuredClone(entity);
  if (entity.type === 'line') {
    const length = Math.hypot(p.x2 - p.x1, p.y2 - p.y1);
    if (length < 1e-10) throw new Error('無法偏移零長度直線');
    return moveVector(entity, doc, -(p.y2 - p.y1) / length * distance, (p.x2 - p.x1) / length * distance);
  }
  if (entity.type === 'circle' || entity.type === 'arc') next.params.radius = p.radius + distance;
  else if (entity.type === 'rect') Object.assign(next.params, { x: p.x - distance, y: p.y - distance, width: p.width + 2 * distance, height: p.height + 2 * distance });
  else throw new Error('文字不支援輪廓偏移');
  vectorNumbers(next, doc);
  return next;
}
/** Translate resolved coordinates while preserving all unrelated dimensions and parameters. */
export function moveVector(entity: VectorEntity, doc: EngineeringDocument, dx: number, dy: number): VectorEntity {
  if (![dx, dy].every(Number.isFinite)) throw new Error('位移必須為有效數字');
  const next = structuredClone(entity);
  for (const key of entity.type === 'line' ? ['x1', 'x2'] : ['x']) next.params[key] = resolveScalar(entity.params[key], doc.parameters) + dx;
  for (const key of entity.type === 'line' ? ['y1', 'y2'] : ['y']) next.params[key] = resolveScalar(entity.params[key], doc.parameters) + dy;
  return next;
}
export function arrayVectors(doc: EngineeringDocument, selected: string[], count: number, dx: number, dy: number): EngineeringDocument {
  const sources = doc.entities.filter(entity => selected.includes(entity.id));
  if (!sources.length) throw new Error('請先選取實體');
  if (!Number.isInteger(count) || count < 2 || count > 100 || doc.entities.length + sources.length * (count - 1) > 2000) throw new Error('陣列超過實體上限');
  const next = structuredClone(doc);
  for (let i = 1; i < count; i++) for (const entity of sources) next.entities.push({ ...moveVector(entity, doc, dx * i, dy * i), id: crypto.randomUUID() });
  return next;
}
