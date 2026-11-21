import { describe, expect, it } from 'vitest';
import { emptyEngineeringDocument } from './document';
import { arrayVectors, moveVector } from './edit';
describe('editable vector transformations', () => {
  it('moves formula coordinates without changing source dimensions or shared parameters', () => {
    const doc = emptyEngineeringDocument('2d'); doc.parameters = { origin: 5, radius: 3 };
    const entity = { id: 'c', type: 'circle' as const, layer: 'geometry', params: { x: '$origin', y: 2, radius: '$radius' } };
    const moved = moveVector(entity, doc, 10, -2);
    expect(moved.params).toEqual({ x: 15, y: 0, radius: '$radius' });
    expect(entity.params.x).toBe('$origin');
    expect(doc.parameters).toEqual({ origin: 5, radius: 3 });
  });
  it('arrays only selected geometry and preserves layers and original entities', () => {
    const doc = emptyEngineeringDocument('2d');
    doc.entities = [{ id: 'a', type: 'line', layer: 'hidden', params: { x1: 0, y1: 0, x2: 10, y2: 0 } }, { id: 'b', type: 'circle', layer: 'geometry', params: { x: 0, y: 0, radius: 2 } }];
    const next = arrayVectors(doc, ['a'], 3, 20, 5);
    expect(next.entities).toHaveLength(4);
    expect(next.entities.slice(0, 2)).toEqual(doc.entities);
    expect(next.entities[3].params).toEqual({ x1: 40, y1: 10, x2: 50, y2: 10 });
    expect(next.entities[3].layer).toBe('hidden');
    expect(new Set(next.entities.map(entity => entity.id)).size).toBe(4);
    expect(doc.entities).toHaveLength(2);
  });
  it('rejects excessive or invalid array requests before copying', () => {
    const doc = emptyEngineeringDocument('2d');
    doc.entities = [{ id: 'a', type: 'circle', layer: 'geometry', params: { x: 0, y: 0, radius: 2 } }];
    expect(() => arrayVectors(doc, ['a'], 101, 1, 0)).toThrow();
    expect(() => arrayVectors(doc, [], 2, 1, 0)).toThrow();
    expect(() => arrayVectors(doc, ['a'], 2, NaN, 0)).toThrow();
  });
});
