import { describe, expect, it } from 'vitest';
import { emptyEngineeringDocument } from './document';
import { arrayVectors, moveVector, offsetVector, transformVectors } from './edit';
describe('editable vector transformations', () => {
  it('rotates rectangles into four connected edges about a custom pivot', () => {
    const doc = emptyEngineeringDocument('2d');
    doc.entities = [{ id: 'r', type: 'rect', layer: 'hidden', params: { x: 1, y: 2, width: 4, height: 2 } }];
    const next = transformVectors(doc, ['r'], 'rotate', 1, 2, 90);
    expect(next.entities).toHaveLength(4);
    expect(next.entities[0].id).toBe('r');
    expect(next.entities[0].params.x2).toBeCloseTo(1);
    expect(next.entities[0].params.y2).toBeCloseTo(6);
    expect(next.entities.every(entity => entity.layer === 'hidden')).toBe(true);
    expect(doc.entities[0].type).toBe('rect');
  });
  it('mirrors arc orientation and preserves unselected geometry', () => {
    const doc = emptyEngineeringDocument('2d');
    doc.entities = [{ id: 'a', type: 'arc', layer: 'geometry', params: { x: 2, y: 3, radius: 4, startAngle: 0, endAngle: 90 } }, { id: 'b', type: 'circle', layer: 'center', params: { x: 8, y: 9, radius: 2 } }];
    const next = transformVectors(doc, ['a'], 'mirrorX', 0, 1);
    expect(next.entities[0].params).toEqual({ x: 2, y: -1, radius: 4, startAngle: -90, endAngle: -0 });
    expect(next.entities[1]).toEqual(doc.entities[1]);
    const restored = transformVectors(next, ['a'], 'mirrorX', 0, 1);
    expect(restored.entities).toEqual(doc.entities);
    expect(() => transformVectors(doc, ['a'], 'rotate', NaN, 0)).toThrow();
  });
  it('offsets a directed line on its left without changing formulas or the source', () => {
    const doc = emptyEngineeringDocument('2d'); doc.parameters = { length: 10 };
    const line = { id: 'a', type: 'line' as const, layer: 'geometry', params: { x1: 0, y1: 0, x2: '$length', y2: 0 } };
    expect(offsetVector(line, doc, 2).params).toEqual({ x1: 0, y1: 2, x2: 10, y2: 2 });
    expect(line.params.x2).toBe('$length');
  });
  it('rejects collapsed circular offsets and expands rectangles around their perimeter', () => {
    const doc = emptyEngineeringDocument('2d');
    const circle = { id: 'c', type: 'circle' as const, layer: 'geometry', params: { x: 0, y: 0, radius: 2 } };
    expect(() => offsetVector(circle, doc, -2)).toThrow();
    expect(offsetVector(circle, doc, 3).params.radius).toBe(5);
    const rect = { id: 'r', type: 'rect' as const, layer: 'geometry', params: { x: 5, y: 6, width: 10, height: 8 } };
    expect(offsetVector(rect, doc, 2).params).toEqual({ x: 3, y: 4, width: 14, height: 12 });
    expect(() => offsetVector(rect, doc, -4)).toThrow();
  });
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
