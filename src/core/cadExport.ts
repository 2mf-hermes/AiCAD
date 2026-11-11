/* ============================================================================
   CAD 匯出（DXF）
   ----------------------------------------------------------------------------
   為什麼要有這一層：PNG 只能看，不能量測、不能改。若這張圖本來就是線稿型
   （機械零件、組立、爆炸圖…），使用者真正的下一步是把它拉進 CAD 繼續編輯。

   幾何來源不是「辨識點陣圖」（那會失真），而是同一份圖面向量：
     - 草稿 SVG（LLM 產生的向量草稿）→ 直線／圓／多段線
     - 應用程式繪製的圖框、標題欄、比例尺、文字標示
     - 使用者在畫布上加的 CAD 物件（含其圖層與顏色）
   點陣底圖本身無法轉成幾何，所以那種情況會誠實回報「僅能匯出向量部分」。

   輸出格式：AutoCAD R12 (AC1009) ASCII DXF —— 最廣相容（AutoCAD、DraftSight、
   LibreCAD、QCAD、SolidWorks 讀入皆可），不需要第三方套件。
   ========================================================================== */

import type { CadEntity, CadLayer } from './cad';
import { estimateTextWidth } from './sheetFurniture';
import type { DrawingKind } from './types';

/** 適合輸出成 CAD 檔的圖面類型：以線稿幾何為主、可量測、可再編輯。 */
const CAD_FRIENDLY: DrawingKind[] = [
  'mechanical-part',
  'assembly',
  'exploded-view',
  'floor-plan',
  'elevation',
  'electrical',
  'piping',
  'schematic',
];

export type CadSuitability = 'vector' | 'raster' | 'unsupported';

/**
 * 判斷這張圖能不能有意義地輸出成 CAD 檔。
 * `vector`：有草稿向量，幾何完整；`raster`：只有點陣底圖，只能匯出圖框與標註；
 * `unsupported`：圖面類型本身不是線稿導向。
 */
export function cadSuitability(kind: DrawingKind, draftSvg?: string): CadSuitability {
  if (!CAD_FRIENDLY.includes(kind)) return 'unsupported';
  return draftSvg && draftSvg.trim() ? 'vector' : 'raster';
}

interface Point {
  x: number;
  y: number;
}

/** 2D 仿射矩陣（與 SVG 相同的 a b c d e f 順序）。 */
export interface Matrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

const IDENTITY: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

function multiply(m: Matrix, n: Matrix): Matrix {
  return {
    a: m.a * n.a + m.c * n.b,
    b: m.b * n.a + m.d * n.b,
    c: m.a * n.c + m.c * n.d,
    d: m.b * n.c + m.d * n.d,
    e: m.a * n.e + m.c * n.f + m.e,
    f: m.b * n.e + m.d * n.f + m.f,
  };
}

function apply(m: Matrix, point: Point): Point {
  return { x: m.a * point.x + m.c * point.y + m.e, y: m.b * point.x + m.d * point.y + m.f };
}

/** 解析 SVG transform 屬性（translate／scale／rotate／matrix）。 */
export function parseTransform(value: string | undefined): Matrix {
  if (!value) return IDENTITY;
  let out = IDENTITY;
  const pattern = /(translate|scale|rotate|matrix)\s*\(([^)]*)\)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value))) {
    const nums = match[2]
      .split(/[\s,]+/)
      .map((entry) => Number(entry))
      .filter((entry) => Number.isFinite(entry));
    if (match[1] === 'translate') {
      out = multiply(out, { ...IDENTITY, e: nums[0] ?? 0, f: nums[1] ?? 0 });
    } else if (match[1] === 'scale') {
      out = multiply(out, { ...IDENTITY, a: nums[0] ?? 1, d: nums[1] ?? nums[0] ?? 1 });
    } else if (match[1] === 'rotate') {
      const angle = ((nums[0] ?? 0) * Math.PI) / 180;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const rotation: Matrix = { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
      const cx = nums[1] ?? 0;
      const cy = nums[2] ?? 0;
      out = multiply(
        out,
        multiply(
          multiply({ ...IDENTITY, e: cx, f: cy }, rotation),
          { ...IDENTITY, e: -cx, f: -cy },
        ),
      );
    } else {
      out = multiply(out, {
        a: nums[0] ?? 1,
        b: nums[1] ?? 0,
        c: nums[2] ?? 0,
        d: nums[3] ?? 1,
        e: nums[4] ?? 0,
        f: nums[5] ?? 0,
      });
    }
  }
  return out;
}

function attr(attrs: string, name: string): string | undefined {
  const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*"([^"]*)"`).exec(attrs);
  return match ? match[1] : undefined;
}

function num(value: string | undefined, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parsePoints(value: string | undefined): Point[] {
  if (!value) return [];
  const nums = value
    .trim()
    .split(/[\s,]+/)
    .map((entry) => Number(entry))
    .filter((entry) => Number.isFinite(entry));
  const points: Point[] = [];
  for (let index = 0; index + 1 < nums.length; index += 2) points.push({ x: nums[index], y: nums[index + 1] });
  return points;
}

/** 把圓弧（A 指令）以足夠的段數攤平成折線；曲線在 CAD 裡仍是可編輯的線段。 */
function arcPoints(from: Point, rx: number, ry: number, rotationDeg: number, largeArc: boolean, sweep: boolean, to: Point): Point[] {
  if (!(rx > 0) || !(ry > 0)) return [to];
  const phi = (rotationDeg * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  const dx = (from.x - to.x) / 2;
  const dy = (from.y - to.y) / 2;
  let x1p = cosPhi * dx + sinPhi * dy;
  let y1p = -sinPhi * dx + cosPhi * dy;
  let rxs = Math.abs(rx);
  let rys = Math.abs(ry);
  const lambda = (x1p * x1p) / (rxs * rxs) + (y1p * y1p) / (rys * rys);
  if (lambda > 1) {
    const scale = Math.sqrt(lambda);
    rxs *= scale;
    rys *= scale;
  }
  const sign = largeArc === sweep ? -1 : 1;
  const numerator = rxs * rxs * rys * rys - rxs * rxs * y1p * y1p - rys * rys * x1p * x1p;
  const denominator = rxs * rxs * y1p * y1p + rys * rys * x1p * x1p;
  const coefficient = denominator === 0 ? 0 : sign * Math.sqrt(Math.max(0, numerator / denominator));
  const cxp = (coefficient * (rxs * y1p)) / rys;
  const cyp = (coefficient * -(rys * x1p)) / rxs;
  const cx = cosPhi * cxp - sinPhi * cyp + (from.x + to.x) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (from.y + to.y) / 2;
  const angleOf = (ux: number, uy: number, vx: number, vy: number) => {
    const dot = ux * vx + uy * vy;
    const length = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    if (length === 0) return 0;
    const value = Math.acos(Math.min(1, Math.max(-1, dot / length)));
    return ux * vy - uy * vx < 0 ? -value : value;
  };
  const ux = (x1p - cxp) / rxs;
  const uy = (y1p - cyp) / rys;
  const vx = (-x1p - cxp) / rxs;
  const vy = (-y1p - cyp) / rys;
  const start = angleOf(1, 0, ux, uy);
  let delta = angleOf(ux, uy, vx, vy);
  if (!sweep && delta > 0) delta -= Math.PI * 2;
  if (sweep && delta < 0) delta += Math.PI * 2;
  const steps = Math.max(8, Math.min(64, Math.ceil(Math.abs(delta) / (Math.PI / 24))));
  const points: Point[] = [];
  for (let index = 1; index <= steps; index += 1) {
    const theta = start + (delta * index) / steps;
    points.push({
      x: cx + rxs * Math.cos(theta) * cosPhi - rys * Math.sin(theta) * sinPhi,
      y: cy + rxs * Math.cos(theta) * sinPhi + rys * Math.sin(theta) * cosPhi,
    });
  }
  return points;
}

export interface Polyline {
  points: Point[];
  closed: boolean;
}

/** 解析 SVG path：直線、二次／三次貝茲、圓弧都攤平成折線。 */
export function pathToPolylines(d: string): Polyline[] {
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? [];
  const out: Polyline[] = [];
  let current: Point = { x: 0, y: 0 };
  let start: Point = { x: 0, y: 0 };
  let line: Point[] = [];
  let command = '';
  let index = 0;

  const next = () => Number(tokens[index++]);
  const flush = (closed = false) => {
    if (line.length > 1) out.push({ points: line, closed });
    line = [];
  };
  const push = (point: Point) => {
    if (line.length === 0) line.push(current);
    line.push(point);
    current = point;
  };

  while (index < tokens.length) {
    if (/^[a-zA-Z]$/.test(tokens[index])) {
      command = tokens[index++];
    }
    const relative = command === command.toLowerCase();
    const base = relative ? current : { x: 0, y: 0 };
    switch (command.toUpperCase()) {
      case 'M': {
        flush();
        const point = { x: base.x + next(), y: base.y + next() };
        current = point;
        start = point;
        line = [point];
        command = relative ? 'l' : 'L';
        break;
      }
      case 'L': {
        push({ x: base.x + next(), y: base.y + next() });
        break;
      }
      case 'H': {
        push({ x: base.x + next(), y: current.y });
        break;
      }
      case 'V': {
        push({ x: current.x, y: base.y + next() });
        break;
      }
      case 'C': {
        const c1 = { x: base.x + next(), y: base.y + next() };
        const c2 = { x: base.x + next(), y: base.y + next() };
        const end = { x: base.x + next(), y: base.y + next() };
        const from = current;
        for (let step = 1; step <= 12; step += 1) {
          const t = step / 12;
          const mt = 1 - t;
          push({
            x: mt * mt * mt * from.x + 3 * mt * mt * t * c1.x + 3 * mt * t * t * c2.x + t * t * t * end.x,
            y: mt * mt * mt * from.y + 3 * mt * mt * t * c1.y + 3 * mt * t * t * c2.y + t * t * t * end.y,
          });
        }
        break;
      }
      case 'Q': {
        const control = { x: base.x + next(), y: base.y + next() };
        const end = { x: base.x + next(), y: base.y + next() };
        const from = current;
        for (let step = 1; step <= 12; step += 1) {
          const t = step / 12;
          const mt = 1 - t;
          push({
            x: mt * mt * from.x + 2 * mt * t * control.x + t * t * end.x,
            y: mt * mt * from.y + 2 * mt * t * control.y + t * t * end.y,
          });
        }
        break;
      }
      case 'A': {
        const rx = next();
        const ry = next();
        const rotation = next();
        const largeArc = next() !== 0;
        const sweep = next() !== 0;
        const end = { x: base.x + next(), y: base.y + next() };
        for (const point of arcPoints(current, rx, ry, rotation, largeArc, sweep, end)) push(point);
        break;
      }
      case 'Z': {
        flush(true);
        current = start;
        line = [start];
        break;
      }
      default: {
        index += 1;
        break;
      }
    }
  }
  flush();
  return out.filter((polyline) => polyline.points.length > 1);
}

export type DxfKind = 'LINE' | 'LWPOLYLINE' | 'CIRCLE' | 'TEXT';

export interface DxfShape {
  kind: DxfKind;
  layer: string;
  points: Point[];
  closed: boolean;
  radius: number;
  text: string;
  height: number;
  rotation: number;
  anchor: 'start' | 'middle' | 'end';
}

interface CollectOptions {
  defaultLayer: string;
  /** 1 = 保留原始 viewBox 比例（不做縮放）。 */
  scale: number;
}

/** 解析 SVG 字串成可寫入 DXF 的圖元集合。 */
export function svgToShapes(svg: string, options: CollectOptions): { shapes: DxfShape[]; skipped: number } {
  const shapes: DxfShape[] = [];
  const stack: { matrix: Matrix; layer: string }[] = [{ matrix: IDENTITY, layer: options.defaultLayer }];
  let skipped = 0;
  const tagPattern = /<(\/?)([a-zA-Z][\w:.-]*)([^>]*?)(\/?)>/g;
  let match: RegExpExecArray | null;
  const toPoints = (points: Point[]) => points.map((point) => apply(stack[stack.length - 1].matrix, point));

  while ((match = tagPattern.exec(svg))) {
    const closing = match[1] === '/';
    const name = match[2].toLowerCase();
    const attrs = match[3] ?? '';
    const selfClosing = match[4] === '/';
    if (closing) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const top = stack[stack.length - 1];
    const layer = attr(attrs, 'data-layer') ?? top.layer;
    const local = multiply(top.matrix, parseTransform(attr(attrs, 'transform')));

    if (name === 'g') {
      stack.push({ matrix: local, layer });
      if (selfClosing) stack.pop();
      continue;
    }
    if (name === 'svg') {
      const x = num(attr(attrs, 'x'));
      const y = num(attr(attrs, 'y'));
      const width = num(attr(attrs, 'width'), 0);
      const height = num(attr(attrs, 'height'), 0);
      const viewBox = (attr(attrs, 'viewBox') ?? '').trim().split(/[\s,]+/).map(Number);
      let matrix = multiply(local, { ...IDENTITY, e: x, f: y });
      if (viewBox.length === 4 && width > 0 && height > 0 && viewBox[2] > 0 && viewBox[3] > 0) {
        matrix = multiply(matrix, {
          a: width / viewBox[2],
          b: 0,
          c: 0,
          d: height / viewBox[3],
          e: -viewBox[0] * (width / viewBox[2]),
          f: -viewBox[1] * (height / viewBox[3]),
        });
      }
      stack.push({ matrix, layer });
      if (selfClosing) stack.pop();
      continue;
    }
    if (name === 'line') {
      shapes.push({
        kind: 'LINE',
        layer,
        points: toPoints([
          { x: num(attr(attrs, 'x1')), y: num(attr(attrs, 'y1')) },
          { x: num(attr(attrs, 'x2')), y: num(attr(attrs, 'y2')) },
        ]),
        closed: false,
        radius: 0,
        text: '',
        height: 0,
        rotation: 0,
        anchor: 'start',
      });
    } else if (name === 'rect') {
      const x = num(attr(attrs, 'x'));
      const y = num(attr(attrs, 'y'));
      const width = num(attr(attrs, 'width'));
      const height = num(attr(attrs, 'height'));
      shapes.push({
        kind: 'LWPOLYLINE',
        layer,
        points: toPoints([
          { x, y },
          { x: x + width, y },
          { x: x + width, y: y + height },
          { x, y: y + height },
          { x, y },
        ]),
        closed: true,
        radius: 0,
        text: '',
        height: 0,
        rotation: 0,
        anchor: 'start',
      });
    } else if (name === 'circle') {
      shapes.push({
        kind: 'CIRCLE',
        layer,
        points: toPoints([{ x: num(attr(attrs, 'cx')), y: num(attr(attrs, 'cy')) }]),
        closed: true,
        radius: num(attr(attrs, 'r')),
        text: '',
        height: 0,
        rotation: 0,
        anchor: 'start',
      });
    } else if (name === 'ellipse') {
      const cx = num(attr(attrs, 'cx'));
      const cy = num(attr(attrs, 'cy'));
      const rx = num(attr(attrs, 'rx'));
      const ry = num(attr(attrs, 'ry'));
      const points: Point[] = [];
      for (let step = 0; step <= 48; step += 1) {
        const theta = (step / 48) * Math.PI * 2;
        points.push({ x: cx + rx * Math.cos(theta), y: cy + ry * Math.sin(theta) });
      }
      shapes.push({ kind: 'LWPOLYLINE', layer, points: toPoints(points), closed: true, radius: 0, text: '', height: 0, rotation: 0, anchor: 'start' });
    } else if (name === 'polyline' || name === 'polygon') {
      shapes.push({
        kind: 'LWPOLYLINE',
        layer,
        points: toPoints(parsePoints(attr(attrs, 'points'))),
        closed: name === 'polygon',
        radius: 0,
        text: '',
        height: 0,
        rotation: 0,
        anchor: 'start',
      });
    } else if (name === 'path') {
      const data = attr(attrs, 'd');
      if (!data) skipped += 1;
      for (const polyline of data ? pathToPolylines(data) : []) {
        shapes.push({
          kind: 'LWPOLYLINE',
          layer,
          points: toPoints(polyline.points),
          closed: polyline.closed,
          radius: 0,
          text: '',
          height: 0,
          rotation: 0,
          anchor: 'start',
        });
      }
    } else if (name === 'text') {
      const raw = attr(attrs, 'x') ?? '0';
      const anchor = (attr(attrs, 'text-anchor') as DxfShape['anchor']) ?? 'start';
      const height = num(attr(attrs, 'font-size'), 12);
      const content = extractText(svg, tagPattern.lastIndex);
      if (!content.decoded.trim()) {
        skipped += 1;
        continue;
      }
      tagPattern.lastIndex = content.end;
      const base = apply(local, { x: num(raw, 0), y: num(attr(attrs, 'y'), 0) });
      const estimate = estimateTextWidth(content.decoded, height);
      shapes.push({
        kind: 'TEXT',
        layer,
        points: [{ x: base.x - (anchor === 'middle' ? estimate / 2 : anchor === 'end' ? estimate : 0), y: base.y }],
        closed: false,
        radius: 0,
        text: content.decoded,
        height,
        rotation: 0,
        anchor,
      });
    } else if (name === 'image') {
      /* 點陣底圖無法轉成幾何，誠實計入 skipped 讓上層提示使用者。 */
      skipped += 1;
    }
  }
  return { shapes, skipped };
}

function extractText(svg: string, from: number): { decoded: string; end: number } {
  const close = svg.toLowerCase().indexOf('</text>', from);
  const stop = close < 0 ? from : close;
  const raw = svg.slice(from, stop).replace(/<[^>]*>/g, '');
  return {
    decoded: raw
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&'),
    end: close < 0 ? svg.length : close + '</text>'.length,
  };
}

const ACI: { name: string; index: number; rgb: [number, number, number] }[] = [
  { name: 'red', index: 1, rgb: [255, 64, 64] },
  { name: 'yellow', index: 2, rgb: [255, 214, 64] },
  { name: 'green', index: 3, rgb: [64, 200, 96] },
  { name: 'cyan', index: 4, rgb: [64, 200, 200] },
  { name: 'blue', index: 5, rgb: [80, 140, 255] },
  { name: 'magenta', index: 6, rgb: [224, 96, 224] },
  { name: 'white', index: 7, rgb: [18, 24, 31] },
];

/** 把十六進位色轉成最接近的 AutoCAD 色號（DXF 只認索引色）。 */
export function aciFromColor(color: string): number {
  const hex = color.replace('#', '');
  if (hex.length < 6) return 7;
  const rgb: [number, number, number] = [
    parseInt(hex.slice(0, 2), 16),
    parseInt(hex.slice(2, 4), 16),
    parseInt(hex.slice(4, 6), 16),
  ];
  let best = ACI[ACI.length - 1];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const entry of ACI) {
    const distance =
      (entry.rgb[0] - rgb[0]) ** 2 + (entry.rgb[1] - rgb[1]) ** 2 + (entry.rgb[2] - rgb[2]) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = entry;
    }
  }
  return best.index;
}

/** DXF 圖層名只允許英數與少數符號，中文名要轉寫才不會被 CAD 讀成亂碼。 */
export function sanitizeLayerName(name: string): string {
  const ascii = name.replace(/[^\x20-\x7E]/g, '');
  const cleaned = ascii.toUpperCase().replace(/[^A-Z0-9_.$-]/g, '_').slice(0, 31);
  return cleaned || 'LAYER';
}

export interface CadExportInput {
  /** 合成後的圖面 SVG（底圖 + 草稿向量 + 標示 + 圖框）。 */
  sheetSvg: string;
  cadEntities?: readonly CadEntity[];
  cadLayers?: readonly CadLayer[];
  /** 出圖尺寸（mm）。預設 A3 橫式。 */
  paperWidth?: number;
  paperHeight: number;
  /** 圖面 viewBox 高度（= 1000 × 圖片高/寬），與 sheetViewHeight 同值。 */
  viewHeight: number;
}

export interface CadExportResult {
  dxf: string;
  counts: { lines: number; polylines: number; circles: number; texts: number; layers: number; skipped: number };
}

/**
 * 把整張圖面轉成 DXF。
 * 座標換算：SVG 的 viewBox（寬 1000、y 向下）→ 圖紙 mm（y 向上）。
 */
export function sheetToDxf(input: CadExportInput): CadExportResult {
  const paperWidth = input.paperWidth ?? 420;
  const paperHeight = input.paperHeight;
  const viewWidth = 1000;
  const scale = paperWidth / viewWidth;
  const flip = (point: Point): Point => ({ x: point.x * scale, y: paperHeight - point.y * scale });

  const collected = svgToShapes(input.sheetSvg, { defaultLayer: 'OUTLINE', scale: 1 });
  const shapes = collected.shapes;
  let skipped = collected.skipped;

  const layers = new Map<string, number>([
    ['FRAME', 7],
    ['TEXT', 7],
    ['OUTLINE', 7],
  ]);

  /* 畫布上的 CAD 物件用 0..1 正規化座標，換算進圖面單位後再翻轉 y。 */
  for (const entity of input.cadEntities ?? []) {
    const layer = entity.layerId;
    const definition = input.cadLayers?.find((entry) => entry.id === layer);
    const layerName = sanitizeLayerName(definition?.name ?? 'CAD');
    layers.set(layerName, aciFromColor(entity.color || definition?.color || '#12181f'));
    const toPoint = (point: Point) => ({ x: point.x * viewWidth, y: point.y * input.viewHeight });
    if (entity.kind === 'circle') {
      shapes.push({
        kind: 'CIRCLE',
        layer: layerName,
        points: [toPoint(entity.center)],
        closed: true,
        radius: entity.radius * viewWidth,
        text: '',
        height: 0,
        rotation: 0,
        anchor: 'start',
      });
    } else if (entity.kind === 'dimension') {
      shapes.push({
        kind: 'LINE',
        layer: layerName,
        points: [toPoint(entity.start), toPoint(entity.end)],
        closed: false,
        radius: 0,
        text: '',
        height: 0,
        rotation: 0,
        anchor: 'start',
      });
      const lengthMm = Math.hypot(entity.end.x - entity.start.x, entity.end.y - entity.start.y) * paperWidth;
      shapes.push({
        kind: 'TEXT',
        layer: 'TEXT',
        points: [toPoint({ x: (entity.start.x + entity.end.x) / 2, y: (entity.start.y + entity.end.y) / 2 })],
        closed: false,
        radius: 0,
        text: lengthMm.toFixed(1),
        height: 2.5 / scale,
        rotation: 0,
        anchor: 'middle',
      });
    } else {
      shapes.push({
        kind: 'LINE',
        layer: layerName,
        points: [toPoint(entity.start), toPoint(entity.end)],
        closed: false,
        radius: 0,
        text: '',
        height: 0,
        rotation: 0,
        anchor: 'start',
      });
    }
  }

  const counts = { lines: 0, polylines: 0, circles: 0, texts: 0, layers: layers.size, skipped };
  const body: string[] = [];

  const push = (...codes: (string | number)[]) => {
    for (const code of codes) body.push(String(code));
  };

  for (const shape of shapes) {
    const layerName = sanitizeLayerName(shape.layer);
    const color = layers.get(layerName) ?? layers.get(shape.layer) ?? 7;
    if (!layers.has(layerName)) layers.set(layerName, color);
    if (shape.kind === 'LINE') {
      const [from, to] = shape.points.map(flip);
      if (!from || !to) continue;
      counts.lines += 1;
      push(0, 'LINE', 8, layerName, 62, color, 10, from.x.toFixed(3), 20, from.y.toFixed(3), 11, to.x.toFixed(3), 21, to.y.toFixed(3));
    } else if (shape.kind === 'CIRCLE') {
      const center = flip(shape.points[0]);
      counts.circles += 1;
      push(0, 'CIRCLE', 8, layerName, 62, color, 10, center.x.toFixed(3), 20, center.y.toFixed(3), 40, (shape.radius * scale).toFixed(3));
    } else if (shape.kind === 'TEXT') {
      const point = flip(shape.points[0]);
      counts.texts += 1;
      push(0, 'TEXT', 8, layerName, 62, color, 10, point.x.toFixed(3), 20, point.y.toFixed(3), 40, Math.max(1.2, shape.height * scale).toFixed(3), 1, shape.text);
    } else {
      const points = shape.points.map(flip);
      if (points.length < 2) continue;
      counts.polylines += 1;
      push(0, 'LWPOLYLINE', 8, layerName, 62, color, 90, points.length, 70, shape.closed ? 1 : 0);
      for (const point of points) push(10, point.x.toFixed(3), 20, point.y.toFixed(3));
    }
  }

  const layerTable = [...layers.entries()]
    .map(([name, color]) =>
      [0, 'LAYER', 2, name, 70, 0, 62, color, 6, 'CONTINUOUS'].join('\n'),
    )
    .join('\n');

  const dxf = [
    '0', 'SECTION', '2', 'HEADER',
    '9', '$ACADVER', '1', 'AC1015',
    '9', '$INSBASE', '10', '0.0', '20', '0.0', '30', '0.0',
    '9', '$EXTMIN', '10', '0.0', '20', '0.0', '30', '0.0',
    '9', '$EXTMAX', '10', paperWidth.toFixed(2), '20', paperHeight.toFixed(2), '30', '0.0',
    '9', '$LIMMIN', '10', '0.0', '20', '0.0',
    '9', '$LIMMAX', '10', paperWidth.toFixed(2), '20', paperHeight.toFixed(2),
    '9', '$INSUNITS', '70', 4,
    '0', 'ENDSEC',
    '0', 'SECTION', '2', 'TABLES',
    '0', 'TABLE', '2', 'LTYPE', '70', 1,
    '0', 'LTYPE', '2', 'CONTINUOUS', '70', 0, '3', 'Solid line', '72', 65, '73', 0, '40', '0.0',
    '0', 'ENDTAB',
    '0', 'TABLE', '2', 'LAYER', '70', layers.size,
    layerTable,
    '0', 'ENDTAB',
    '0', 'ENDSEC',
    '0', 'SECTION', '2', 'ENTITIES',
    ...body,
    '0', 'ENDSEC',
    '0', 'EOF',
  ].join('\n');

  counts.layers = layers.size;
  return { dxf, counts };
}
