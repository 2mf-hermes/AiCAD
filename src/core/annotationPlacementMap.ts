/* ============================================================================
   標註位置解析（App 端的唯一入口）
   ----------------------------------------------------------------------------
   Artboard 上存的是模型回報的原始位置陣列（可序列化、進得了專案檔），
   疊加層要的是「圖面單位、已夾回安全範圍」的位置表。

   兩者之間就只有這一個函式 —— 預覽與匯出都呼叫它，
   所以不可能出現「預覽疊在帶上、匯出疊在模型位置上」這種兩套結果。
   ========================================================================== */

import { resolveAnnotationPlacements, type AnnotationPosition } from './annotationOverlay';
import type { SheetLayout } from './sheetLayout';
import type { Artboard } from './types';

export function annotationPositionsFor(
  artboard: Artboard,
  layout: SheetLayout,
  viewHeight: number,
): ReadonlyMap<string, AnnotationPosition> | undefined {
  const placements = artboard.annotationPlacements;
  if (!placements || placements.length === 0) return undefined;
  const { positions } = resolveAnnotationPlacements({ intent: artboard.intent, layout, viewHeight }, placements);
  return positions.size > 0 ? positions : undefined;
}
