import { describe, expect, it, beforeAll } from 'vitest';
import initOC from 'replicad-opencascadejs';
import { setOC } from 'replicad';
import { buildGeometry } from './kernel';
import { emptyEngineeringDocument, resolveScalar, validateEngineeringDocument, protectLocalEdit } from './document';

beforeAll(async () => { setOC(await initOC()); }, 120000);
describe('restricted parametric expressions', () => {
  it('resolves linked dimensions with precedence', () => {
    expect(resolveScalar('$width * 0.5 + 2', { width: 80 })).toBe(42);
    expect(resolveScalar('(width - 4) / 2', { width: 'depth * 2', depth: 12 })).toBe(10);
  });
  it('rejects cycles and executable input', () => {
    expect(() => resolveScalar('a', { a: 'b', b: 'a' })).toThrow();
    expect(() => resolveScalar('globalThis.alert(1)', {})).toThrow();
    expect(() => resolveScalar('1 / 0', {})).toThrow();
  });
});
describe('real OpenCascade solids', () => {
  it('extrudes rectangular and circular closed profiles with legacy corner coordinates', () => {
    const doc = emptyEngineeringDocument('3d');
    doc.features = [{ id: 'profile', name: 'Rectangle extrusion', type: 'extrude', params: { width: 20, height: 10, depth: 6, x: 3, y: 4 }, inputs: [] }];
    const rectangular = buildGeometry(doc);
    try {
      expect(rectangular.result.volume).toBeCloseTo(1200, 6);
      const vertices = rectangular.result.bodies[0].mesh.vertices;
      const xs = vertices.filter((_, index) => index % 3 === 0);
      const ys = vertices.filter((_, index) => index % 3 === 1);
      expect(Math.min(...xs)).toBeCloseTo(3);
      expect(Math.min(...ys)).toBeCloseTo(4);
      expect(Math.max(...xs)).toBeCloseTo(23);
    } finally { rectangular.dispose(); }
    doc.features[0].params = { radius: 5, depth: 6 };
    const circular = buildGeometry(doc);
    try { expect(circular.result.volume).toBeCloseTo(Math.PI * 25 * 6, 6); }
    finally { circular.dispose(); }
  });
  it.each(['Z', 'Y'] as const)('places orthographic views using first and third angle with %s up', (upAxis) => {
    const doc = emptyEngineeringDocument('3d'); doc.settings.upAxis = upAxis;
    doc.features = [{ id: 'base', name: 'Base', type: 'box', params: { width: 80, height: 40, depth: 12 }, inputs: [] }];
    for (const projection of ['first', 'third'] as const) {
      doc.settings.projection = projection;
      const built = buildGeometry(doc);
      try {
        const drawing = built.project();
        const coords = (plane: string, axis: string) => drawing.entities.filter(e => e.id.includes(`.${plane}.`) && e.type === 'line').flatMap(e => [Number(e.params[axis + '1']), Number(e.params[axis + '2'])]);
        const frontX = coords('front', 'x'), frontY = coords('front', 'y');
        const rightX = coords('right', 'x'), topY = coords('top', 'y');
        expect(Math.max(...frontX) - Math.min(...frontX)).toBeCloseTo(80);
        expect(Math.max(...frontY) - Math.min(...frontY)).toBeCloseTo(upAxis === 'Z' ? 12 : 40);
        if (projection === 'third') {
          expect(Math.min(...rightX)).toBeGreaterThan(Math.max(...frontX));
          expect(Math.min(...topY)).toBeGreaterThan(Math.max(...frontY));
        } else {
          expect(Math.max(...rightX)).toBeLessThan(Math.min(...frontX));
          expect(Math.max(...topY)).toBeLessThan(Math.min(...frontY));
        }
      } finally { built.dispose(); }
    }
  });
  it('projects exact B-Rep hole geometry into editable visible, hidden and center layers', () => {
    const doc = emptyEngineeringDocument('3d');
    doc.features = [
      { id: 'base', name: 'Base', type: 'box', params: { width: 80, height: 40, depth: 12 }, inputs: [] },
      { id: 'tool', name: 'Hole', type: 'cylinder', params: { radius: 6, height: 14, x: 20, y: 20, z: -1 }, inputs: [] },
      { id: 'cut', name: 'Cut', type: 'cut', params: {}, inputs: ['base', 'tool'] },
    ];
    const built = buildGeometry(doc);
    try {
      const drawing = validateEngineeringDocument(built.project());
      expect(drawing.mode).toBe('2d');
      expect(drawing.entities.some(e => e.layer === 'hidden')).toBe(true);
      expect(drawing.entities.some(e => e.layer === 'center')).toBe(true);
      expect(drawing.entities.some(e => e.type === 'circle' && Math.abs(Number(e.params.radius) - 6) < 1e-6)).toBe(true);
      expect(drawing.entities.length).toBeGreaterThan(20);
    } finally { built.dispose(); }
  });
  it('cuts an exact through-hole and exports B-Rep STEP', async () => {
    const doc = emptyEngineeringDocument('3d');
    doc.features = [
      { id: 'base', name: 'Base', type: 'box', params: { width: 80, height: 40, depth: 12 }, inputs: [] },
      { id: 'hole', name: 'Hole tool', type: 'cylinder', params: { radius: 6, height: 14, x: 20, y: 20, z: -1 }, inputs: [] },
      { id: 'result', name: 'Through hole', type: 'cut', params: {}, inputs: ['base', 'hole'] },
    ];
    const built = buildGeometry(doc);
    try {
      expect(built.result.bodies).toHaveLength(1);
      expect(built.result.volume).toBeCloseTo(80 * 40 * 12 - Math.PI * 36 * 12, 3);
      expect(built.result.bodies[0].mesh.triangles.length).toBeGreaterThan(20);
      expect(await built.step().text()).toContain('MANIFOLD_SOLID_BREP');
      const changed = structuredClone(doc); changed.features[0].params.width = 90;
      const rebuilt = buildGeometry(changed);
      try { expect(rebuilt.result.volume - built.result.volume).toBeCloseTo(10 * 40 * 12, 3); } finally { rebuilt.dispose(); }
    } finally { built.dispose(); }
  });
  it('rejects empty booleans instead of accepting invalid geometry', () => {
    const doc = emptyEngineeringDocument('3d');
    doc.features = [
      { id: 'a', name: 'A', type: 'box', params: { width: 10, height: 10, depth: 10 }, inputs: [] },
      { id: 'b', name: 'B', type: 'box', params: { width: 20, height: 20, depth: 20, x: -1, y: -1, z: -1 }, inputs: [] },
      { id: 'c', name: 'Empty', type: 'cut', params: {}, inputs: ['a', 'b'] },
    ];
    expect(() => buildGeometry(doc)).toThrow();
  });
});
it('protects geometry outside a local AI selection', () => {
  const doc = emptyEngineeringDocument('2d');
  doc.entities = [{ id: 'a', type: 'circle', layer: 'geometry', params: { x: 0, y: 0, radius: 10 } }, { id: 'b', type: 'circle', layer: 'geometry', params: { x: 20, y: 0, radius: 5 } }];
  const next = structuredClone(doc); next.entities[1].params.radius = 9;
  expect(() => protectLocalEdit(doc, next, ['a'])).toThrow();
  expect(() => protectLocalEdit(doc, next, ['b'])).not.toThrow();
  next.entities[1].id = 'a'; expect(() => validateEngineeringDocument(next)).toThrow();
});
