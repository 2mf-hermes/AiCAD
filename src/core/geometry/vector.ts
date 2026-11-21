import { resolveScalar, type EngineeringDocument, type VectorEntity } from './document';
export function vectorNumbers(entity: VectorEntity, doc: EngineeringDocument): Record<string, number> {
  const values = Object.fromEntries(Object.entries(entity.params).map(([key, value]) => [key, resolveScalar(value, doc.parameters)]));
  const required = { line: ['x1', 'y1', 'x2', 'y2'], circle: ['x', 'y', 'radius'], rect: ['x', 'y', 'width', 'height'], arc: ['x', 'y', 'radius', 'startAngle', 'endAngle'], text: ['x', 'y', 'height'] }[entity.type];
  if (required.some(key => !Number.isFinite(values[key]))) throw new Error(`Missing vector coordinates: ${entity.id}`);
  for (const key of ['radius', 'width', 'height']) if (key in values && values[key] <= 0) throw new Error(`Invalid vector size: ${entity.id}`);
  return values;
}
const escape = (text: string) => text.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[ch]!));
export function vectorElement(entity: VectorEntity, doc: EngineeringDocument): string {
  const p = vectorNumbers(entity, doc);
  switch (entity.type) {
    case 'line': return `<line x1="${p.x1}" y1="${-p.y1}" x2="${p.x2}" y2="${-p.y2}"/>`;
    case 'rect': return `<rect x="${p.x}" y="${-p.y - p.height}" width="${p.width}" height="${p.height}"/>`;
    case 'circle': return `<circle cx="${p.x}" cy="${-p.y}" r="${p.radius}"/>`;
    case 'text': return `<text fill="currentColor" stroke="none" x="${p.x}" y="${-p.y}" font-size="${p.height}">${escape(entity.text ?? '')}</text>`;
    case 'arc': {
      const a = p.startAngle * Math.PI / 180; const b = p.endAngle * Math.PI / 180; const sweep = ((p.endAngle - p.startAngle) % 360 + 360) % 360;
      return `<path d="M ${p.x + p.radius * Math.cos(a)} ${-p.y - p.radius * Math.sin(a)} A ${p.radius} ${p.radius} 0 ${sweep > 180 ? 1 : 0} 0 ${p.x + p.radius * Math.cos(b)} ${-p.y - p.radius * Math.sin(b)}"/>`;
    }
  }
}
export function vectorBounds(doc: EngineeringDocument): [number, number, number, number] {
  const points: [number, number][] = [[0, 0]];
  for (const entity of doc.entities) {
    const p = vectorNumbers(entity, doc);
    if (entity.type === 'line') points.push([p.x1, -p.y1], [p.x2, -p.y2]);
    else { const size = p.radius ?? 0; points.push([p.x - size, -p.y - size - (p.height ?? 0)], [p.x + size + (p.width ?? (entity.type === 'text' ? (entity.text?.length ?? 1) * p.height : 0)), -p.y + size]); }
  }
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]); const minX = Math.min(...xs), minY = Math.min(...ys);
  const width = Math.max(...xs) - minX, height = Math.max(...ys) - minY; const margin = Math.max(width, height, 20) * 0.08;
  return [minX - margin, minY - margin, width + margin * 2, height + margin * 2];
}
export function exportVectorSvg(doc: EngineeringDocument, cutting = false): string {
  const entities = cutting ? doc.entities.filter(entity => entity.layer === 'geometry' && entity.type !== 'text') : doc.entities;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vectorBounds(doc).join(' ')}" style="color:black" fill="none" stroke="currentColor" stroke-width="0.25">${entities.map(entity => `<g id="${escape(entity.id)}" data-layer="${escape(entity.layer)}"${entity.layer === 'hidden' ? ' stroke-dasharray="2 1"' : entity.layer === 'center' ? ' stroke-dasharray="4 1 1 1"' : ''}>${vectorElement(entity, doc)}</g>`).join('')}</svg>`;
}
export function exportVectorDxf(doc: EngineeringDocument, cutting = false): string {
  const records: (string | number)[] = [0, 'SECTION', 2, 'HEADER', 9, '$INSUNITS', 70, doc.settings.units === 'in' ? 1 : 4, 0, 'ENDSEC', 0, 'SECTION', 2, 'TABLES', 0, 'TABLE', 2, 'LTYPE', 70, 3];
  const patterns: Record<string, number[]> = { CONTINUOUS: [], HIDDEN: [2, -1], CENTER: [4, -1, 1, -1] };
  for (const [name, pattern] of Object.entries(patterns)) {
    records.push(0, 'LTYPE', 2, name, 70, 0, 3, name, 72, 65, 73, pattern.length, 40, pattern.reduce((sum, n) => sum + Math.abs(n), 0));
    for (const n of pattern) records.push(49, n);
  }
  records.push(0, 'ENDTAB', 0, 'ENDSEC', 0, 'SECTION', 2, 'ENTITIES');
  for (const entity of doc.entities) {
    if (cutting && (entity.layer !== 'geometry' || entity.type === 'text')) continue;
    const p = vectorNumbers(entity, doc); const layer = entity.layer.replace(/[^\w.-]/g, '_');
    const lineType = entity.layer === 'hidden' ? 'HIDDEN' : entity.layer === 'center' ? 'CENTER' : 'CONTINUOUS';
    const line = (x1: number, y1: number, x2: number, y2: number) => records.push(0, 'LINE', 8, layer, 6, lineType, 10, x1, 20, y1, 11, x2, 21, y2);
    switch (entity.type) {
      case 'line': line(p.x1, p.y1, p.x2, p.y2); break;
      case 'rect': line(p.x, p.y, p.x + p.width, p.y); line(p.x + p.width, p.y, p.x + p.width, p.y + p.height); line(p.x + p.width, p.y + p.height, p.x, p.y + p.height); line(p.x, p.y + p.height, p.x, p.y); break;
      case 'circle': case 'arc': records.push(0, entity.type.toUpperCase(), 8, layer, 6, lineType, 10, p.x, 20, p.y, 40, p.radius); if (entity.type === 'arc') records.push(50, p.startAngle, 51, p.endAngle); break;
      case 'text': records.push(0, 'TEXT', 8, layer, 10, p.x, 20, p.y, 40, p.height, 1, (entity.text ?? '').replace(/[\r\n]/g, ' ')); break;
    }
  }
  records.push(0, 'ENDSEC', 0, 'EOF'); return records.join('\r\n');
}
