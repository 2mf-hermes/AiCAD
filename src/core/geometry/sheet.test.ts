import { describe, expect, it } from 'vitest';
import { emptyEngineeringDocument } from './document';
import { exportDrawingSheet } from './sheet';
describe('physical drawing sheet export', () => {
  it('uses paper millimetres, model scale and escaped title metadata', () => {
    const doc = emptyEngineeringDocument('2d');
    doc.settings.paper = 'A3'; doc.settings.scale = 0.5; doc.settings.title = '<Plate & bracket>';
    doc.entities = [{ id: 'r', type: 'rect', layer: 'geometry', params: { x: 0, y: 0, width: 80, height: 40 } }];
    const svg = exportDrawingSheet(doc);
    expect(svg).toContain('width="420mm" height="297mm"');
    expect(svg).toContain('scale(0.5)');
    expect(svg).toContain('&lt;Plate &amp; bracket&gt;');
    expect(svg).toContain('THIRD ANGLE');
  });
  it('converts inch model coordinates to physical paper millimetres', () => {
    const doc = emptyEngineeringDocument('2d'); doc.settings.units = 'in';
    doc.entities = [{ id: 'r', type: 'circle', layer: 'geometry', params: { x: 0, y: 0, radius: 1 } }];
    expect(exportDrawingSheet(doc)).toContain('scale(25.4)');
  });
  it('rejects a drawing that would be clipped at the requested scale', () => {
    const doc = emptyEngineeringDocument('2d');
    doc.entities = [{ id: 'r', type: 'rect', layer: 'geometry', params: { x: 0, y: 0, width: 1000, height: 500 } }];
    expect(() => exportDrawingSheet(doc)).toThrow('圖面超出圖幅');
  });
});
