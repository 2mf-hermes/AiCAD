import { describe, expect, it } from 'vitest';
import { emptyEngineeringDocument } from './document';
import { exportVectorDxf, exportVectorSvg } from './vector';
describe('editable vector exports', () => {
  const doc = emptyEngineeringDocument('2d');
  doc.entities = [
    { id: 'outline', type: 'rect', layer: 'geometry', params: { x: 0, y: 0, width: 80, height: 40 } },
    { id: 'hidden', type: 'line', layer: 'hidden', params: { x1: 5, y1: 0, x2: 5, y2: 40 } },
    { id: 'axis', type: 'line', layer: 'center', params: { x1: 40, y1: -5, x2: 40, y2: 45 } },
    { id: 'note', type: 'text', layer: 'notes', text: '<孔 & 80>', params: { x: 0, y: 50, height: 3 } },
  ];
  it('writes explicit DXF hidden and center line types and millimetre units', () => {
    const dxf = exportVectorDxf(doc);
    expect(dxf).toContain('$INSUNITS\r\n70\r\n4');
    expect(dxf).toContain('LTYPE');
    expect(dxf).toContain('6\r\nHIDDEN'); expect(dxf).toContain('6\r\nCENTER');
  });
  it('exports cutting geometry at original size without notes or construction lines', () => {
    const dxf = exportVectorDxf(doc, true);
    expect(dxf.match(/\r\nLINE\r\n/g)).toHaveLength(4);
    expect(dxf).toContain('11\r\n80');
    expect(dxf).not.toContain('<孔'); expect(dxf).not.toContain('8\r\ncenter'); expect(dxf).not.toContain('8\r\nhidden');
  });
  it('escapes SVG annotation text and preserves engineering line patterns', () => {
    const svg = exportVectorSvg(doc);
    expect(svg).toContain('&lt;孔 &amp; 80&gt;'); expect(svg).toContain('stroke-dasharray="2 1"');
    expect(svg).toContain('stroke-dasharray="4 1 1 1"');
  });
});
