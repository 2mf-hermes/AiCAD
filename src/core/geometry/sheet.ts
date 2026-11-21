import type { EngineeringDocument } from './document';
import { vectorBounds, vectorElement } from './vector';
const paperSizes = { A4: [297, 210], A3: [420, 297], A2: [594, 420], A1: [841, 594], A0: [1189, 841] } as const;
const xml = (text: string) => text.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[ch]!));
/** Physical paper dimensions are millimetres; model coordinates retain their document units. */
export function exportDrawingSheet(doc: EngineeringDocument): string {
  const [width, height] = paperSizes[doc.settings.paper];
  const unit = doc.settings.units === 'in' ? 25.4 : 1;
  const scale = doc.settings.scale * unit;
  const [x, y, w, h] = vectorBounds(doc);
  const availableWidth = width - 30, availableHeight = height - 65;
  if (w * scale > availableWidth || h * scale > availableHeight) throw new Error('圖面超出圖幅，請降低比例或選擇較大圖幅');
  const tx = 15 + (availableWidth - w * scale) / 2 - x * scale;
  const ty = 15 + (availableHeight - h * scale) / 2 - y * scale;
  const titleX = width - 190, titleY = height - 45;
  const text = (px: number, py: number, value: string, size = 3) => `<text x="${px}" y="${py}" font-size="${size}" fill="black" stroke="none">${xml(value)}</text>`;
  const rows = [
    `${doc.settings.title || doc.name} · ${doc.settings.partNumber}`,
    `${doc.settings.material} · REV ${doc.settings.revision}`,
    `${doc.settings.standard} · ${doc.settings.projection === 'third' ? 'THIRD ANGLE' : 'FIRST ANGLE'} · ${doc.settings.units}`,
    `SCALE ${doc.settings.scale}:1 · ${doc.settings.generalTolerance}`,
  ];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}mm" height="${height}mm" viewBox="0 0 ${width} ${height}" fill="none" stroke="black" stroke-width="0.25" style="color:black;font-family:Arial,sans-serif"><rect width="${width}" height="${height}" fill="white" stroke="none"/><rect x="10" y="10" width="${width - 20}" height="${height - 20}"/><g transform="translate(${tx} ${ty}) scale(${scale})" stroke-width="${0.5 / scale}">${doc.entities.map(entity => `<g data-layer="${xml(entity.layer)}"${entity.layer === 'hidden' ? ' stroke-dasharray="2 1"' : entity.layer === 'center' ? ' stroke-dasharray="4 1 1 1"' : ''}>${vectorElement(entity, doc)}</g>`).join('')}</g><rect x="${titleX}" y="${titleY}" width="180" height="35"/>${rows.map((row, i) => `${i ? `<path d="M${titleX} ${titleY + i * 8.75}h180"/>` : ''}${text(titleX + 3, titleY + 6 + i * 8.75, row)}`).join('')}</svg>`;
}
