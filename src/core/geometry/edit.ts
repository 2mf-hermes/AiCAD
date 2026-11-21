import { resolveScalar, type EngineeringDocument, type VectorEntity } from './document';
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
