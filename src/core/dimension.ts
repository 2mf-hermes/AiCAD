/* ============================================================================
   尺寸標註幾何
   ----------------------------------------------------------------------------
   畫布（DrawingCanvas）與匯出（cadExport）共用同一份幾何計算，兩邊才不會各畫各的：
   畫面上看到的箭頭、延伸線、文字位置，就是匯出 DXF 時算出來的同一組線段。

   尺寸線偏移量、箭頭長度都以「圖面邊長 1.0」為單位（與 CadPoint 同一套 0..1 座標）。
   ========================================================================== */

import type { CadDimensionEntity, CadEntity, CadPoint, DimensionMode } from './cad';

/** 以圖面邊長為單位的尺寸線偏移與箭頭尺寸。 */
const OFFSET = 0.055;
/** 連續標註的偏移較小，才疊得出鏈式外觀。 */
const OFFSET_CHAIN = 0.03;
const ARROW = 0.018;
const ARROW_SPREAD = 0.5;
const DEG = 180 / Math.PI;

export interface DimensionSegment { start: CadPoint; end: CadPoint; }
export interface DimensionArrow { at: CadPoint; /** 箭頭指向（單位向量）。 */ dir: CadPoint; }
export interface DimensionArc { center: CadPoint; radius: number; from: number; to: number; }

export interface DimensionGeometry {
  /** 延伸線：量測點到尺寸線的細線。 */
  extensions: DimensionSegment[];
  /** 尺寸線本體。 */
  line: DimensionSegment;
  arrows: DimensionArrow[];
  /** 角度標註的弧線（角度值為 from→to，逆時針）。 */
  arc?: DimensionArc;
  text: { value: string; x: number; y: number; rotate: number };
}

const sub = (a: CadPoint, b: CadPoint): CadPoint => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: CadPoint, b: CadPoint): CadPoint => ({ x: a.x + b.x, y: a.y + b.y });
const scale = (a: CadPoint, k: number): CadPoint => ({ x: a.x * k, y: a.y * k });
const len = (a: CadPoint) => Math.hypot(a.x, a.y);
function unit(a: CadPoint): CadPoint {
  const l = len(a);
  return l < 1e-9 ? { x: 1, y: 0 } : { x: a.x / l, y: a.y / l };
}
/** 左法線：把尺寸線從量測點往外推。 */
const normal = (a: CadPoint): CadPoint => unit({ x: -a.y, y: a.x });
const mid = (a: CadPoint, b: CadPoint): CadPoint => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** 箭頭張開的兩筆短線：以箭尖為頂點、沿方向往後張開。 */
export function arrowLines(arrow: DimensionArrow): [DimensionSegment, DimensionSegment] {
  const back = scale(arrow.dir, -ARROW);
  const side = scale(normal(arrow.dir), ARROW * ARROW_SPREAD);
  return [
    { start: arrow.at, end: add(add(arrow.at, back), side) },
    { start: arrow.at, end: add(add(arrow.at, back), scale(side, -1)) },
  ];
}

/** 量測值：畫面的座標系是 0..1，換算成 1000 單位的圖面長度（與舊版一致）。 */
export function measureLength(from: CadPoint, to: CadPoint): number {
  return Math.round(len(sub(to, from)) * 1000);
}

/** 角度標註需要一個頂點，以及兩條邊的方向。 */
export interface AngleResolved { vertex: CadPoint; a: number; b: number; }

/**
 * 角度標註的頂點解析：拖曳起點若落在既有線端點附近，就以該端點為頂點
 * （那條線自動成為第一條邊），否則以拖曳起點為頂點、拖曳方向為第一條邊。
 */
export function resolveAngle(entities: readonly CadEntity[], start: CadPoint, end: CadPoint): AngleResolved | null {
  const incident = endpointsNear(entities, start);
  const vertex = incident?.point ?? start;
  const second = unit(sub(end, vertex));
  if (len(sub(end, vertex)) < 1e-6) return null;
  const first = incident ? unit(sub(incident.lineStart === vertex ? incident.lineEnd : incident.lineStart, vertex)) : unit(sub(start, vertex));
  if (len(first) < 1e-6) return null;
  const a = Math.atan2(first.y, first.x);
  const b = Math.atan2(second.y, second.x);
  return { vertex, a, b };
}

interface Incident { point: CadPoint; lineStart: CadPoint; lineEnd: CadPoint; }

/** 找出離 point 最近的既有線端點（含尺寸線端點不算，避免自我參照）。 */
function endpointsNear(entities: readonly CadEntity[], point: CadPoint, tolerance = 0.05): Incident | null {
  let best: Incident | null = null;
  let bestDistance = tolerance;
  for (const entity of entities) {
    if (entity.kind === 'circle') continue;
    for (const candidate of [entity.start, entity.end]) {
      const d = len(sub(candidate, point));
      if (d < bestDistance) {
        bestDistance = d;
        best = { point: candidate, lineStart: entity.start, lineEnd: entity.end };
      }
    }
  }
  return best;
}

export interface DimensionMeasure {
  /** 顯示文字（未手動輸入時）。 */
  label: string;
  value: number;
  unitSuffix: string;
}

/**
 * 各種類型的量測值與預設文字：
 *   線性＝沿主軸投影、對齊／雙箭頭＝實際距離、角度＝夾角、半徑／直徑＝半徑、連續＝沿主軸投影。
 */
export function measureDimension(entity: CadDimensionEntity, entities: readonly CadEntity[] = []): DimensionMeasure {
  const dx = entity.end.x - entity.start.x;
  const dy = entity.end.y - entity.start.y;
  switch (entity.mode) {
    case 'angular': {
      const resolved = resolveAngle(entities, entity.start, entity.end);
      if (!resolved) return { label: '0°', value: 0, unitSuffix: '°' };
      let delta = (resolved.b - resolved.a) * DEG;
      while (delta <= -180) delta += 360;
      while (delta > 180) delta -= 360;
      const value = Math.round(Math.abs(delta) * 10) / 10;
      return { label: `${value}°`, value, unitSuffix: '°' };
    }
    case 'radius': {
      const value = measureLength(entity.start, entity.end);
      return { label: `R${value}`, value, unitSuffix: '' };
    }
    case 'diameter': {
      const value = measureLength(entity.start, entity.end) * 2;
      return { label: `⌀${value}`, value, unitSuffix: '' };
    }
    case 'aligned':
    case 'double-arrow': {
      const value = measureLength(entity.start, entity.end);
      return { label: String(value), value, unitSuffix: '' };
    }
    default: {
      // linear / continue：水平或垂直投影，取較長的一軸為主軸。
      const value = Math.abs(dx) >= Math.abs(dy) ? Math.round(Math.abs(dx) * 1000) : Math.round(Math.abs(dy) * 1000);
      return { label: String(value), value, unitSuffix: '' };
    }
  }
}

/** 建立尺寸標註的完整幾何；螢幕與匯出共用。 */
export function dimensionGeometry(entity: CadDimensionEntity, entities: readonly CadEntity[] = []): DimensionGeometry {
  const measure = measureDimension(entity, entities);
  const value = entity.text && entity.text.trim() ? entity.text.trim() : measure.label;
  const direction = unit(sub(entity.end, entity.start));

  switch (entity.mode) {
    case 'angular': {
      const resolved = resolveAngle(entities, entity.start, entity.end) ?? { vertex: entity.start, a: 0, b: Math.atan2(direction.y, direction.x) };
      const radius = Math.min(0.22, Math.max(0.08, Math.min(len(sub(entity.start, resolved.vertex)), len(sub(entity.end, resolved.vertex))) * 0.75));
      let from = resolved.a;
      let to = resolved.b;
      // 一律以逆時針小弧呈現，閱讀方向才固定。
      if (to - from < -Math.PI) to += Math.PI * 2;
      if (to - from > Math.PI) { const swap = from; from = to; to = swap + Math.PI * 2; }
      const at = (angle: number): CadPoint => ({ x: resolved.vertex.x + Math.cos(angle) * radius, y: resolved.vertex.y + Math.sin(angle) * radius });
      const midAngle = (from + to) / 2;
      return {
        extensions: [
          { start: resolved.vertex, end: at(from) },
          { start: resolved.vertex, end: at(to) },
        ],
        line: { start: at(from), end: at(to) },
        arc: { center: resolved.vertex, radius, from, to },
        // 弧線兩端箭頭都指向弧內側（雙箭頭角度標註）。
        arrows: [
          { at: at(from), dir: { x: Math.cos(from + Math.PI / 2), y: Math.sin(from + Math.PI / 2) } },
          { at: at(to), dir: { x: -Math.cos(to + Math.PI / 2), y: -Math.sin(to + Math.PI / 2) } },
        ],
        text: {
          value,
          x: resolved.vertex.x + Math.cos(midAngle) * (radius + 0.03),
          y: resolved.vertex.y + Math.sin(midAngle) * (radius + 0.03),
          rotate: 0,
        },
      };
    }
    case 'radius': {
      // 由圓心（start）指向圓周（end）的引線，單箭頭指在圓周上。
      const labelPoint = mid(entity.start, entity.end);
      return {
        extensions: [],
        line: { start: entity.start, end: entity.end },
        arrows: [{ at: entity.end, dir: direction }],
        text: { value, x: labelPoint.x + normal(direction).x * 0.02, y: labelPoint.y + normal(direction).y * 0.02, rotate: 0 },
      };
    }
    case 'diameter': {
      // 貫穿圓心：由 end 的另一側穿過 start 到 end，兩端箭頭。
      const opposite = sub(entity.start, sub(entity.end, entity.start));
      return {
        extensions: [],
        line: { start: opposite, end: entity.end },
        arrows: [{ at: opposite, dir: scale(direction, -1) }, { at: entity.end, dir: direction }],
        text: { value, x: entity.start.x, y: entity.start.y - 0.028, rotate: 0 },
      };
    }
    case 'double-arrow': {
      // 雙箭頭（外向）：箭頭由內往外指，不加延伸線，常用於間距或對稱標示。
      return {
        extensions: [],
        line: { start: entity.start, end: entity.end },
        arrows: [{ at: entity.start, dir: scale(direction, -1) }, { at: entity.end, dir: direction }],
        text: { value, x: mid(entity.start, entity.end).x, y: mid(entity.start, entity.end).y - 0.028, rotate: 0 },
      };
    }
    case 'aligned': {
      const offset = normal(direction);
      const a = add(entity.start, scale(offset, OFFSET));
      const b = add(entity.end, scale(offset, OFFSET));
      const labelPoint = mid(a, b);
      const rotate = (Math.atan2(direction.y, direction.x) * DEG + 360) % 180;
      return {
        extensions: [{ start: entity.start, end: a }, { start: entity.end, end: b }],
        line: { start: a, end: b },
        arrows: [{ at: a, dir: direction }, { at: b, dir: scale(direction, -1) }],
        text: {
          value,
          x: labelPoint.x + scale(offset, 0.014).x,
          y: labelPoint.y + scale(offset, 0.014).y,
          rotate: rotate > 90 ? rotate - 180 : rotate,
        },
      };
    }
    default: {
      // linear / continue：水平或垂直投影，尺寸線與量測軸平行、往外偏移。
      const horizontal = Math.abs(entity.end.x - entity.start.x) >= Math.abs(entity.end.y - entity.start.y);
      const offset = entity.mode === 'continue' ? OFFSET_CHAIN : OFFSET;
      // 偏移一律往上／往左外側，避免壓在物件上。
      const push = horizontal
        ? { x: 0, y: entity.start.y <= 0.5 ? offset : -offset }
        : { x: entity.start.x <= 0.5 ? offset : -offset, y: 0 };
      const a = horizontal ? { x: entity.start.x, y: entity.start.y + push.y } : { x: entity.start.x + push.x, y: entity.start.y };
      const b = horizontal ? { x: entity.end.x, y: entity.end.y + push.y } : { x: entity.end.x + push.x, y: entity.end.y };
      const dir = unit(sub(b, a));
      const labelPoint = mid(a, b);
      return {
        extensions: [{ start: entity.start, end: a }, { start: entity.end, end: b }],
        line: { start: a, end: b },
        arrows: [{ at: a, dir }, { at: b, dir: scale(dir, -1) }],
        text: {
          value,
          x: labelPoint.x,
          y: labelPoint.y + (horizontal ? -0.022 : 0),
          rotate: horizontal ? 0 : -90,
        },
      };
    }
  }
}

/** 所有類型的清單（工具列選單與測試共用）。 */
export const DIMENSION_MODE_LIST: { value: DimensionMode; label: string; hint: string }[] = [
  { value: 'linear', label: '線性', hint: '量水平或垂直投影距離' },
  { value: 'aligned', label: '對齊', hint: '沿量測方向量實際長度' },
  { value: 'angular', label: '角度', hint: '以角的頂點量夾角（拖曳起點取頂點）' },
  { value: 'radius', label: '半徑', hint: '自圓心指到圓周，單箭頭 R 值' },
  { value: 'diameter', label: '直徑', hint: '貫穿圓心、兩端箭頭 ⌀ 值' },
  { value: 'double-arrow', label: '雙箭頭', hint: '兩端箭頭朝外，標示間距' },
  { value: 'continue', label: '連續', hint: '接續上一個已選尺寸繼續量' },
];
