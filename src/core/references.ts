import type { ReferenceAttachment } from './types';
import { createSafeId } from './projectSafety';

export const REFERENCE_LIMIT = 4;
export const REFERENCE_BYTES = 2 * 1024 * 1024;
const imageTypes = ['image/png', 'image/jpeg', 'image/webp'];
export function normalizeReferences(value: unknown): ReferenceAttachment[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, REFERENCE_LIMIT).flatMap(item => {
    if (!item || typeof item !== 'object') return [];
    const { id, name, mimeType, dataUrl } = item;
    if (typeof name !== 'string' || typeof dataUrl !== 'string' || dataUrl.length > REFERENCE_BYTES * 1.4) return [];
    if (![...imageTypes, 'text/plain'].includes(mimeType) || !dataUrl.startsWith(`data:${mimeType};base64,`) || !/^[A-Za-z0-9+/]*={0,2}$/.test(dataUrl.split(',')[1])) return [];
    return [{ id: typeof id === 'string' ? id : createSafeId('ref'), name: name.slice(0, 200), mimeType, dataUrl }];
  });
}
export async function readReference(file: File): Promise<ReferenceAttachment> {
  if (file.size > REFERENCE_BYTES) throw new Error(`${file.name} 超過 2 MiB 上限`);
  const mimeType = imageTypes.includes(file.type) ? file.type : /\.(txt|md|csv|json|xml|yaml|yml|log)$/i.test(file.name) ? 'text/plain' : '';
  if (!mimeType) throw new Error(`${file.name} 尚不支援。請使用 PNG/JPEG/WebP 或 UTF-8 文字、CSV、JSON 檔；PDF、Office、DWG 請先轉換。`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (mimeType === 'text/plain') {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (bytes.includes(0)) throw new Error('不支援二進位文字檔');
    if (bytes.length > 64000) throw new Error('文字參考上限為 64 KB，請擷取相關內容');
  } else {
    const bitmap = await createImageBitmap(file);
    const tooLarge = bitmap.width * bitmap.height > 24000000;
    bitmap.close();
    if (tooLarge) throw new Error('圖片上限為 2400 萬像素');
  }
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return { id: createSafeId('ref'), name: file.name, mimeType, dataUrl: `data:${mimeType};base64,${btoa(binary)}` };
}
export function referenceText(ref: ReferenceAttachment): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(ref.dataUrl.split(',')[1]), c => c.charCodeAt(0)));
}
