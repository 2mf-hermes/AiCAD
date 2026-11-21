import { describe, expect, it } from 'vitest';
import { emptyEngineeringDocument, protectLocalEdit, validateEngineeringDocument } from './document';
import { exportVectorDxf, exportVectorSvg } from './vector';

describe('engineering document boundaries', () => {
  it('rejects incomplete coordinates and invalid engineering settings', () => {
    const doc = emptyEngineeringDocument('2d');
    doc.entities = [{ id: 'line', type: 'line', layer: 'geometry', params: { x1: 0, y1: 0 } }];
    expect(() => validateEngineeringDocument(doc)).toThrow();
    doc.entities = []; doc.settings.precision = 2.5;
    expect(() => validateEngineeringDocument(doc)).toThrow();
  });
  it('permits connected local hole features but protects unselected bodies', () => {
    const doc = emptyEngineeringDocument('3d');
    doc.features = ['base', 'other'].map(id => ({ id, name: id, type: 'box' as const, inputs: [], params: { width: 80, height: 40, depth: 12 } }));
    const next = structuredClone(doc);
    next.features.push({ id: 'tool', name: 'tool', type: 'cylinder', inputs: [], params: { radius: 3, height: 20 } }, { id: 'hole', name: 'hole', type: 'cut', inputs: ['base', 'tool'], params: {} });
    expect(() => protectLocalEdit(doc, next, ['base'])).not.toThrow();
    next.features.at(-1)!.inputs = ['other', 'tool'];
    expect(() => protectLocalEdit(doc, next, ['base'])).toThrow();
  });
  it('rejects disconnected new solids during a local edit', () => {
    const doc = emptyEngineeringDocument('3d');
    doc.features = [{ id: 'base', name: 'base', type: 'sphere', inputs: [], params: { radius: 5 } }];
    const next = structuredClone(doc); next.features.push({ ...next.features[0], id: 'unrelated' });
    expect(() => protectLocalEdit(doc, next, ['base'])).toThrow();
  });
  it('preserves drawing layers, safe text, units and clean cutting geometry on export', () => {
    const doc = emptyEngineeringDocument('2d'); doc.settings.units = 'in';
    doc.entities = [
      { id: 'outline', type: 'circle', layer: 'geometry', params: { x: 0, y: 0, radius: 2 } },
      { id: 'hidden', type: 'line', layer: 'hidden', params: { x1: 0, y1: 0, x2: 1, y2: 1 } },
      { id: 'note', type: 'text', layer: 'notes', text: '<script>alert(1)</script>', params: { x: 0, y: 0, height: 0.1 } },
    ];
    expect(exportVectorSvg(doc)).toContain('stroke-dasharray="2 1"');
    expect(exportVectorSvg(doc)).not.toContain('<script>');
    const dxf = exportVectorDxf(doc, true);
    expect(dxf).toContain('$INSUNITS\r\n70\r\n1');
    expect(dxf).toContain('CIRCLE'); expect(dxf).not.toContain('TEXT'); expect(dxf).not.toContain('hidden');
  });
});
