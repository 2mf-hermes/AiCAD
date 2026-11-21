import { makeBox, makeCylinder, makeSphere, drawRectangle, drawCircle, isShape3D, measureVolume, exportSTEP, type Shape3D, type ShapeMesh } from 'replicad';
import { resolveScalar, validateEngineeringDocument, type EngineeringDocument } from './document';
import { projectBodies } from './projection';
export interface BodyMesh { id: string; mesh: ShapeMesh; edges: number[]; volume: number }
export interface GeometryResult { bodies: BodyMesh[]; volume: number }
export function buildGeometry(input: EngineeringDocument): { result: GeometryResult; dispose: () => void; step: () => Blob; stl: () => Blob; project: () => EngineeringDocument } {
  const doc = validateEngineeringDocument(input);
  const shapes = new Map<string, Shape3D>();
  const consumed = new Set<string>();
  const dispose = () => { for (const shape of shapes.values()) shape.delete(); shapes.clear(); };
  try {
    for (const feature of doc.features) {
      if (feature.suppressed) continue;
      const n = (key: string, fallback?: number) => resolveScalar(feature.params[key] ?? fallback, doc.parameters);
      const positive = (key: string) => { const v = n(key); if (v <= 0 || v > 100000) throw new Error(`Invalid ${key}`); return v; };
      const source = (index: number) => { const id = feature.inputs[index]; const shape = shapes.get(id); if (!shape) throw new Error(`Missing input ${id}`); consumed.add(id); return shape.clone(); };
      let shape: Shape3D;
      switch (feature.type) {
        case 'box': shape = makeBox([0, 0, 0], [positive('width'), positive('height'), positive('depth')]); break;
        case 'extrude': {
          const circular = 'radius' in feature.params;
          const width = circular ? 0 : positive('width'), height = circular ? 0 : positive('height');
          const profile = circular ? drawCircle(positive('radius')) : drawRectangle(width, height);
          const extruded = profile.sketchOnPlane('XY').extrude(positive('depth'));
          if (!isShape3D(extruded)) { extruded.delete(); throw new Error('Profile does not form a solid'); }
          shape = circular ? extruded : extruded.translate(width / 2, height / 2, 0);
          break;
        }
        case 'cylinder': shape = makeCylinder(positive('radius'), positive('height')); break;
        case 'sphere': shape = makeSphere(positive('radius')); break;
        case 'union': case 'cut': case 'intersect': {
          const a = source(0); const b = source(1);
          try { shape = feature.type === 'union' ? a.fuse(b) : feature.type === 'cut' ? a.cut(b) : a.intersect(b); }
          finally { a.delete(); b.delete(); }
          break;
        }
        case 'fillet': case 'chamfer': {
          const original = source(0);
          try { shape = feature.type === 'fillet' ? original.fillet(positive('radius')) : original.chamfer(positive('radius')); }
          finally { original.delete(); }
          break;
        }
        case 'translate': shape = source(0); break;
        default: throw new Error('Unsupported feature');
      }
      shape = shape.translate(n('x', 0), n('y', 0), n('z', 0));
      shapes.set(feature.id, shape);
      const volume = measureVolume(shape);
      if (!Number.isFinite(volume) || volume <= 1e-9 || !shape.solids.length) throw new Error('Feature does not form a closed solid');
    }
    const bodies: BodyMesh[] = [];
    for (const [id, shape] of shapes) if (!consumed.has(id)) {
      const mesh = shape.mesh({ tolerance: doc.settings.meshTolerance, angularTolerance: 0.2 });
      if (!mesh.triangles.length || mesh.vertices.some(v => !Number.isFinite(v))) throw new Error('Invalid solid mesh');
      bodies.push({ id, mesh, edges: shape.meshEdges({ tolerance: doc.settings.meshTolerance }).lines, volume: measureVolume(shape) });
    }
    return {
      result: { bodies, volume: bodies.reduce((sum, body) => sum + body.volume, 0) }, dispose,
      project: () => projectBodies(bodies.map(body => ({ id: body.id, shape: shapes.get(body.id)! })), doc),
      step: () => exportSTEP(bodies.map(body => ({ shape: shapes.get(body.id)!, name: body.id })), { unit: doc.settings.units === 'in' ? 'INCH' : 'MM', modelUnit: doc.settings.units === 'in' ? 'INCH' : 'MM' }),
      stl: () => { if (bodies.length !== 1) throw new Error('STL export requires one final body'); return shapes.get(bodies[0].id)!.blobSTL(); },
    };
  } catch (error) { dispose(); throw error; }
}
