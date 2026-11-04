export type CadTool =
  | 'select' | 'line' | 'rectangle' | 'circle' | 'erase' | 'copy' | 'move'
  | 'dimension' | 'trim' | 'extend' | 'offset' | 'rotate' | 'mirror'
  | 'block' | 'array' | 'align' | 'matchprop';
export type OsnapMode = 'endpoint' | 'midpoint' | 'center' | 'quadrant' | 'intersection';
export type DimensionMode = 'linear' | 'aligned' | 'angular' | 'continue';
export type ArrayMode = 'rectangular' | 'polar' | 'path';
export interface CadPoint { x: number; y: number; }
export interface CadLayer { id: string; name: string; color: string; visible: boolean; locked: boolean; }
export interface CadBlockDefinition { id: string; name: string; entityIds: string[]; dynamic: boolean; }
interface CadEntityBase { id: string; layerId: string; color: string; }
export interface CadLineEntity extends CadEntityBase { kind: 'line'; start: CadPoint; end: CadPoint; }
export interface CadCircleEntity extends CadEntityBase { kind: 'circle'; center: CadPoint; radius: number; }
export interface CadDimensionEntity extends CadEntityBase { kind: 'dimension'; start: CadPoint; end: CadPoint; mode: DimensionMode; }
export type CadSegmentEntity = CadLineEntity | CadDimensionEntity;
export type CadEntity = CadLineEntity | CadCircleEntity | CadDimensionEntity;
export interface CadSnapResult extends CadPoint { mode: OsnapMode; }
export interface CadWorkspaceState {
  activeTool: CadTool;
  activeLayerId: string;
  layers: CadLayer[];
  osnapEnabled: boolean;
  osnapModes: OsnapMode[];
  command: string;
  dimensionMode: DimensionMode;
  arrayMode: ArrayMode;
  arrayRows: number;
  arrayColumns: number;
  arrayCount: number;
  blocks: CadBlockDefinition[];
  entities: CadEntity[];
  selectedEntityIds: string[];
}

export const CAD_COMMAND_ALIASES: Readonly<Record<string, CadTool>> = {
  l: 'line', line: 'line', rec: 'rectangle', rect: 'rectangle', rectangle: 'rectangle',
  c: 'circle', circle: 'circle', e: 'erase', erase: 'erase', del: 'erase',
  co: 'copy', copy: 'copy', m: 'move', move: 'move', dim: 'dimension', d: 'dimension',
  dimension: 'dimension', trim: 'trim', tr: 'trim', extend: 'extend', ex: 'extend',
  offset: 'offset', o: 'offset', rotate: 'rotate', ro: 'rotate', mirror: 'mirror', mi: 'mirror',
  block: 'block', b: 'block', array: 'array', ar: 'array', align: 'align', al: 'align',
  matchprop: 'matchprop', ma: 'matchprop', select: 'select', esc: 'select',
};
export function resolveCadCommand(command: string): CadTool | undefined { return CAD_COMMAND_ALIASES[command.trim().toLowerCase()]; }

const VALID_TOOLS: CadTool[] = ['select', 'line', 'rectangle', 'circle', 'erase', 'copy', 'move', 'dimension', 'trim', 'extend', 'offset', 'rotate', 'mirror', 'block', 'array', 'align', 'matchprop'];
const VALID_SNAP: OsnapMode[] = ['endpoint', 'midpoint', 'center', 'quadrant', 'intersection'];
const VALID_DIM: DimensionMode[] = ['linear', 'aligned', 'angular', 'continue'];
const VALID_ARRAY: ArrayMode[] = ['rectangular', 'polar', 'path'];
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const EPSILON = 1e-9;
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const clampPoint = (point: CadPoint): CadPoint => ({ x: clamp(point.x, 0, 1), y: clamp(point.y, 0, 1) });
const isPoint = (value: unknown): value is CadPoint => Boolean(value)
  && typeof (value as CadPoint).x === 'number' && Number.isFinite((value as CadPoint).x)
  && typeof (value as CadPoint).y === 'number' && Number.isFinite((value as CadPoint).y);
const distance = (a: CadPoint, b: CadPoint) => Math.hypot(a.x - b.x, a.y - b.y);
const lerp = (a: CadPoint, b: CadPoint, t: number): CadPoint => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const parameterOnLine = (point: CadPoint, start: CadPoint, end: CadPoint) => {
  const dx = end.x - start.x; const dy = end.y - start.y;
  return Math.abs(dx) >= Math.abs(dy) ? (point.x - start.x) / (dx || EPSILON) : (point.y - start.y) / (dy || EPSILON);
};

export function createDefaultCadWorkspace(): CadWorkspaceState {
  return {
    activeTool: 'select', activeLayerId: 'geometry',
    layers: [
      { id: 'geometry', name: 'Geometry', color: '#2D3138', visible: true, locked: false },
      { id: 'dimension', name: 'Dimension', color: '#2563EB', visible: true, locked: false },
      { id: 'annotation', name: 'Annotation', color: '#A16207', visible: true, locked: false },
    ],
    osnapEnabled: true,
    osnapModes: ['endpoint', 'midpoint', 'center', 'quadrant', 'intersection'],
    command: '', dimensionMode: 'linear', arrayMode: 'rectangular',
    arrayRows: 2, arrayColumns: 3, arrayCount: 6,
    blocks: [], entities: [], selectedEntityIds: [],
  };
}

function normalizeEntity(value: unknown, layers: CadLayer[]): CadEntity | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<CadEntity> & Record<string, unknown>;
  if (typeof raw.id !== 'string' || !raw.id) return null;
  const layerId = typeof raw.layerId === 'string' && layers.some((layer) => layer.id === raw.layerId) ? raw.layerId : layers[0].id;
  const color = typeof raw.color === 'string' && HEX_COLOR.test(raw.color) ? raw.color : layers.find((layer) => layer.id === layerId)?.color ?? '#2D3138';
  if ((raw.kind === 'line' || raw.kind === 'dimension') && isPoint(raw.start) && isPoint(raw.end)) {
    const common = { id: raw.id, layerId, color, start: clampPoint(raw.start), end: clampPoint(raw.end) };
    return raw.kind === 'line'
      ? { ...common, kind: 'line' }
      : { ...common, kind: 'dimension', mode: VALID_DIM.includes(raw.mode as DimensionMode) ? raw.mode as DimensionMode : 'linear' };
  }
  if (raw.kind === 'circle' && isPoint(raw.center) && typeof raw.radius === 'number' && Number.isFinite(raw.radius) && raw.radius > 0) {
    return { id: raw.id, layerId, color, kind: 'circle', center: clampPoint(raw.center), radius: clamp(raw.radius, 0.0001, 1) };
  }
  return null;
}

export function normalizeCadWorkspace(value?: Partial<CadWorkspaceState> | null): CadWorkspaceState {
  const defaults = createDefaultCadWorkspace();
  if (!value || typeof value !== 'object') return defaults;
  const seenLayerIds = new Set<string>();
  const rawLayers = Array.isArray(value.layers) ? value.layers : [];
  const layers = rawLayers.flatMap((layer): CadLayer[] => {
    if (!layer || typeof layer !== 'object') return [];
    const item = layer as Partial<CadLayer>;
    if (typeof item.id !== 'string' || !item.id || seenLayerIds.has(item.id)) return [];
    seenLayerIds.add(item.id);
    const rawName = typeof item.name === 'string' ? item.name.trim().slice(0, 80) : '';
    return [{ id: item.id.slice(0, 120), name: rawName || item.id.slice(0, 80), color: typeof item.color === 'string' && HEX_COLOR.test(item.color) ? item.color : '#2D3138', visible: typeof item.visible === 'boolean' ? item.visible : true, locked: typeof item.locked === 'boolean' ? item.locked : false }];
  });
  const safeLayers = layers.length ? layers.slice(0, 100) : defaults.layers;
  const seenEntityIds = new Set<string>();
  const entities = (Array.isArray(value.entities) ? value.entities : []).slice(0, 5000)
    .map((entity) => normalizeEntity(entity, safeLayers))
    .filter((entity): entity is CadEntity => {
      if (!entity || seenEntityIds.has(entity.id)) return false;
      seenEntityIds.add(entity.id);
      return true;
    });
  const entityIds = new Set(entities.map((entity) => entity.id));
  const selectedEntityIds = Array.isArray(value.selectedEntityIds)
    ? Array.from(new Set(value.selectedEntityIds.filter((id): id is string => {
      if (typeof id !== 'string' || !entityIds.has(id)) return false;
      const entity = entities.find((item) => item.id === id);
      const layer = entity && safeLayers.find((item) => item.id === entity.layerId);
      return Boolean(layer?.visible && !layer.locked);
    })))
    : [];
  const seenBlockIds = new Set<string>();
  const blocks = (Array.isArray(value.blocks) ? value.blocks : []).slice(0, 500).flatMap((block): CadBlockDefinition[] => {
    if (!block || typeof block !== 'object') return [];
    const item = block as Partial<CadBlockDefinition>;
    if (typeof item.id !== 'string' || !item.id || seenBlockIds.has(item.id)) return [];
    seenBlockIds.add(item.id);
    const memberIds = Array.isArray(item.entityIds) ? Array.from(new Set(item.entityIds.filter((id): id is string => typeof id === 'string' && entityIds.has(id)))) : [];
    if (!memberIds.length) return [];
    return [{ id: item.id.slice(0, 120), name: typeof item.name === 'string' && item.name.trim() ? item.name.trim().slice(0, 80) : 'Block', entityIds: memberIds, dynamic: Boolean(item.dynamic) }];
  });
  return {
    ...defaults,
    activeTool: VALID_TOOLS.includes(value.activeTool as CadTool) ? value.activeTool as CadTool : defaults.activeTool,
    activeLayerId: safeLayers.some((layer) => layer.id === value.activeLayerId && layer.visible && !layer.locked)
      ? value.activeLayerId!
      : safeLayers.find((layer) => layer.visible && !layer.locked)?.id ?? safeLayers[0].id,
    layers: safeLayers,
    osnapEnabled: typeof value.osnapEnabled === 'boolean' ? value.osnapEnabled : defaults.osnapEnabled,
    osnapModes: Array.isArray(value.osnapModes) ? Array.from(new Set(value.osnapModes.filter((mode): mode is OsnapMode => VALID_SNAP.includes(mode as OsnapMode)))) : defaults.osnapModes,
    command: typeof value.command === 'string' ? value.command.slice(0, 80) : '',
    dimensionMode: VALID_DIM.includes(value.dimensionMode as DimensionMode) ? value.dimensionMode as DimensionMode : defaults.dimensionMode,
    arrayMode: VALID_ARRAY.includes(value.arrayMode as ArrayMode) ? value.arrayMode as ArrayMode : defaults.arrayMode,
    arrayRows: clamp(Number.isFinite(value.arrayRows) ? Math.round(value.arrayRows!) : defaults.arrayRows, 1, 20),
    arrayColumns: clamp(Number.isFinite(value.arrayColumns) ? Math.round(value.arrayColumns!) : defaults.arrayColumns, 1, 20),
    arrayCount: clamp(Number.isFinite(value.arrayCount) ? Math.round(value.arrayCount!) : defaults.arrayCount, 2, 36),
    blocks, entities, selectedEntityIds,
  };
}

function lineLineIntersection(a0: CadPoint, a1: CadPoint, b0: CadPoint, b1: CadPoint, constrainA = true, constrainB = true): CadPoint | null {
  const denominator = (a0.x - a1.x) * (b0.y - b1.y) - (a0.y - a1.y) * (b0.x - b1.x);
  if (Math.abs(denominator) < EPSILON) return null;
  const t = ((a0.x - b0.x) * (b0.y - b1.y) - (a0.y - b0.y) * (b0.x - b1.x)) / denominator;
  const u = -((a0.x - a1.x) * (a0.y - b0.y) - (a0.y - a1.y) * (a0.x - b0.x)) / denominator;
  if ((constrainA && (t < -EPSILON || t > 1 + EPSILON)) || (constrainB && (u < -EPSILON || u > 1 + EPSILON))) return null;
  return lerp(a0, a1, t);
}

function lineCircleIntersections(start: CadPoint, end: CadPoint, circle: CadCircleEntity, constrainLine = true): CadPoint[] {
  const dx = end.x - start.x; const dy = end.y - start.y;
  const fx = start.x - circle.center.x; const fy = start.y - circle.center.y;
  const a = dx * dx + dy * dy;
  if (a < EPSILON) return [];
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - circle.radius * circle.radius;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < -EPSILON) return [];
  const root = Math.sqrt(Math.max(0, discriminant));
  return [(-b - root) / (2 * a), (-b + root) / (2 * a)]
    .filter((t, index, values) => (!constrainLine || (t >= -EPSILON && t <= 1 + EPSILON)) && (index === 0 || Math.abs(t - values[0]) > EPSILON))
    .map((t) => lerp(start, end, t));
}

function circleCircleIntersections(a: CadCircleEntity, b: CadCircleEntity): CadPoint[] {
  const d = distance(a.center, b.center);
  if (d < EPSILON || d > a.radius + b.radius + EPSILON || d < Math.abs(a.radius - b.radius) - EPSILON) return [];
  const along = (a.radius ** 2 - b.radius ** 2 + d ** 2) / (2 * d);
  const height = Math.sqrt(Math.max(0, a.radius ** 2 - along ** 2));
  const x = a.center.x + along * (b.center.x - a.center.x) / d;
  const y = a.center.y + along * (b.center.y - a.center.y) / d;
  const rx = -(b.center.y - a.center.y) * height / d;
  const ry = (b.center.x - a.center.x) * height / d;
  const first = { x: x + rx, y: y + ry };
  return height < EPSILON ? [first] : [first, { x: x - rx, y: y - ry }];
}

export function cadEntityIntersections(a: CadEntity, b: CadEntity): CadPoint[] {
  if (a.kind === 'circle' && b.kind === 'circle') return circleCircleIntersections(a, b);
  if (a.kind === 'circle' && b.kind !== 'circle') return lineCircleIntersections(b.start, b.end, a);
  if (a.kind !== 'circle' && b.kind === 'circle') return lineCircleIntersections(a.start, a.end, b);
  if (a.kind === 'circle' || b.kind === 'circle') return [];
  const point = lineLineIntersection(a.start, a.end, b.start, b.end);
  return point ? [point] : [];
}

function dedupeSnapPoints(points: CadSnapResult[]): CadSnapResult[] {
  return points.filter((point, index) => points.findIndex((other) => Math.abs(other.x - point.x) < 1e-7 && Math.abs(other.y - point.y) < 1e-7) === index);
}

export function cadSnapPointsForModes(entities: CadEntity[], modes: OsnapMode[]): CadSnapResult[] {
  const enabled = new Set(modes);
  const points = entities.flatMap((entity): CadSnapResult[] => {
    if (entity.kind === 'circle') {
      const result: CadSnapResult[] = [];
      if (enabled.has('center')) result.push({ ...entity.center, mode: 'center' });
      if (enabled.has('quadrant')) result.push(
        { x: entity.center.x + entity.radius, y: entity.center.y, mode: 'quadrant' },
        { x: entity.center.x - entity.radius, y: entity.center.y, mode: 'quadrant' },
        { x: entity.center.x, y: entity.center.y + entity.radius, mode: 'quadrant' },
        { x: entity.center.x, y: entity.center.y - entity.radius, mode: 'quadrant' },
      );
      return result.filter((point) => point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1);
    }
    const result: CadSnapResult[] = [];
    if (enabled.has('endpoint')) result.push({ ...entity.start, mode: 'endpoint' }, { ...entity.end, mode: 'endpoint' });
    if (enabled.has('midpoint')) result.push({ x: (entity.start.x + entity.end.x) / 2, y: (entity.start.y + entity.end.y) / 2, mode: 'midpoint' });
    return result;
  });
  if (enabled.has('intersection')) {
    for (let first = 0; first < entities.length; first += 1) {
      for (let second = first + 1; second < entities.length; second += 1) {
        for (const point of cadEntityIntersections(entities[first], entities[second])) points.push({ ...point, mode: 'intersection' });
      }
    }
  }
  return dedupeSnapPoints(points);
}

export function cadSnapCandidatesForModes(entities: CadEntity[], modes: OsnapMode[]): CadPoint[] {
  return cadSnapPointsForModes(entities, modes).map(({ x, y }) => ({ x, y }));
}

export function cadSnapCandidates(entities: CadEntity[]): CadPoint[] {
  return cadSnapCandidatesForModes(entities, VALID_SNAP);
}

export function findCadSnap(point: CadPoint, entities: CadEntity[], modes: OsnapMode[], tolerance = 0.02): CadSnapResult | null {
  let best: CadSnapResult | null = null; let bestDistance = tolerance;
  for (const candidate of cadSnapPointsForModes(entities, modes)) {
    const candidateDistance = distance(point, candidate);
    if (candidateDistance <= bestDistance) { best = candidate; bestDistance = candidateDistance; }
  }
  return best;
}

export function snapCadPoint(point: CadPoint, candidates: CadPoint[], tolerance = 0.02): CadPoint {
  let best = point; let bestDistance = tolerance;
  for (const candidate of candidates) {
    const candidateDistance = distance(point, candidate);
    if (candidateDistance <= bestDistance) { best = candidate; bestDistance = candidateDistance; }
  }
  return best;
}

function pointSegmentDistance(point: CadPoint, start: CadPoint, end: CadPoint): number {
  const dx = end.x - start.x; const dy = end.y - start.y;
  if (Math.abs(dx) < EPSILON && Math.abs(dy) < EPSILON) return distance(point, start);
  const t = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy), 0, 1);
  return distance(point, lerp(start, end, t));
}

export function findNearestCadEntity(entities: CadEntity[], point: CadPoint, tolerance = 0.035): CadEntity | undefined {
  let nearest: CadEntity | undefined; let best = tolerance;
  for (const entity of entities) {
    const entityDistance = entity.kind === 'circle' ? Math.abs(distance(point, entity.center) - entity.radius) : pointSegmentDistance(point, entity.start, entity.end);
    if (entityDistance <= best) { nearest = entity; best = entityDistance; }
  }
  return nearest;
}

/** Converts a screen-space hit radius to normalized drawing coordinates. */
export function cadToleranceForViewport(width: number, height: number, pixels = 10): number {
  const shortestSide = Math.max(1, Math.min(width, height));
  return clamp(pixels / shortestSide, 0.003, 0.035);
}

export function getCadLayer(workspace: CadWorkspaceState, layerId: string): CadLayer | undefined {
  return workspace.layers.find((layer) => layer.id === layerId);
}
export function isCadEntityEditable(workspace: CadWorkspaceState, entity: CadEntity): boolean {
  const layer = getCadLayer(workspace, entity.layerId);
  return Boolean(layer?.visible && !layer.locked);
}
export function editableCadEntityIds(workspace: CadWorkspaceState, ids: string[]): string[] {
  const requested = new Set(ids);
  return workspace.entities.filter((entity) => requested.has(entity.id) && isCadEntityEditable(workspace, entity)).map((entity) => entity.id);
}
export function expandCadBlockSelection(workspace: CadWorkspaceState, ids: string[]): string[] {
  const expanded = new Set(ids);
  let changed = true;
  while (changed) {
    changed = false;
    for (const block of workspace.blocks) {
      if (!block.entityIds.some((id) => expanded.has(id))) continue;
      for (const id of block.entityIds) if (!expanded.has(id)) { expanded.add(id); changed = true; }
    }
  }
  return Array.from(expanded);
}

export function translateCadEntity(entity: CadEntity, delta: CadPoint, id = entity.id): CadEntity {
  const move = (point: CadPoint) => clampPoint({ x: point.x + delta.x, y: point.y + delta.y });
  if (entity.kind === 'circle') return { ...entity, id, center: move(entity.center) };
  return { ...entity, id, start: move(entity.start), end: move(entity.end) };
}

export function rotateCadEntity(entity: CadEntity, center: CadPoint, angleRadians: number, id = entity.id): CadEntity {
  const rotate = (point: CadPoint): CadPoint => {
    const dx = point.x - center.x; const dy = point.y - center.y;
    return clampPoint({ x: center.x + dx * Math.cos(angleRadians) - dy * Math.sin(angleRadians), y: center.y + dx * Math.sin(angleRadians) + dy * Math.cos(angleRadians) });
  };
  if (entity.kind === 'circle') return { ...entity, id, center: rotate(entity.center) };
  return { ...entity, id, start: rotate(entity.start), end: rotate(entity.end) };
}

export function mirrorCadEntity(entity: CadEntity, axisX: number, id = entity.id): CadEntity {
  const mirror = (point: CadPoint): CadPoint => clampPoint({ x: axisX * 2 - point.x, y: point.y });
  if (entity.kind === 'circle') return { ...entity, id, center: mirror(entity.center) };
  return { ...entity, id, start: mirror(entity.start), end: mirror(entity.end) };
}

export function offsetCadEntity(entity: CadEntity, amount: number, id = entity.id): CadEntity | null {
  if (entity.kind === 'circle') {
    const radius = entity.radius + amount;
    return radius > 0.0001 ? { ...entity, id, radius: clamp(radius, 0.0001, 1) } : null;
  }
  const dx = entity.end.x - entity.start.x; const dy = entity.end.y - entity.start.y;
  const length = Math.hypot(dx, dy);
  if (length < EPSILON) return null;
  const delta = { x: -dy / length * amount, y: dx / length * amount };
  return { ...entity, id, start: clampPoint({ x: entity.start.x + delta.x, y: entity.start.y + delta.y }), end: clampPoint({ x: entity.end.x + delta.x, y: entity.end.y + delta.y }) };
}

export function createCadEntity(workspace: CadWorkspaceState, tool: 'line' | 'circle' | 'dimension', start: CadPoint, end: CadPoint, id: string): CadEntity | null {
  const layer = getCadLayer(workspace, workspace.activeLayerId);
  if (!layer || layer.locked || !layer.visible || distance(start, end) < 0.006) return null;
  const base = { id, layerId: layer.id, color: layer.color };
  if (tool === 'circle') return { ...base, kind: 'circle', center: start, radius: distance(start, end) };
  if (tool === 'dimension') return { ...base, kind: 'dimension', start, end, mode: workspace.dimensionMode };
  return { ...base, kind: 'line', start, end };
}

export function createCadRectangle(workspace: CadWorkspaceState, start: CadPoint, end: CadPoint, ids: string[]): CadLineEntity[] {
  const points = [start, { x: end.x, y: start.y }, end, { x: start.x, y: end.y }];
  if (Math.abs(start.x - end.x) < 0.006 || Math.abs(start.y - end.y) < 0.006 || ids.length < 4) return [];
  return points.map((point, index) => createCadEntity(workspace, 'line', point, points[(index + 1) % points.length], ids[index])).filter((entity): entity is CadLineEntity => entity?.kind === 'line');
}

export function deleteCadEntities(workspace: CadWorkspaceState, ids: string[]): CadWorkspaceState {
  const removed = new Set(editableCadEntityIds(workspace, expandCadBlockSelection(workspace, ids)));
  if (!removed.size) return workspace;
  return {
    ...workspace,
    entities: workspace.entities.filter((entity) => !removed.has(entity.id)),
    selectedEntityIds: workspace.selectedEntityIds.filter((id) => !removed.has(id)),
    blocks: workspace.blocks.map((block) => ({ ...block, entityIds: block.entityIds.filter((id) => !removed.has(id)) })).filter((block) => block.entityIds.length),
  };
}

export function addCadLayer(workspace: CadWorkspaceState, layer: CadLayer): CadWorkspaceState {
  if (workspace.layers.some((item) => item.id === layer.id) || workspace.layers.length >= 100) return workspace;
  const name = layer.name.trim().slice(0, 80);
  return { ...workspace, layers: [...workspace.layers, { ...layer, name: name || `Layer ${workspace.layers.length + 1}`, color: HEX_COLOR.test(layer.color) ? layer.color : '#2D3138' }], activeLayerId: layer.id };
}

export function updateCadLayer(workspace: CadWorkspaceState, id: string, delta: Partial<Omit<CadLayer, 'id'>>): CadWorkspaceState {
  const layer = getCadLayer(workspace, id);
  if (!layer) return workspace;
  const color = typeof delta.color === 'string' && HEX_COLOR.test(delta.color) ? delta.color : layer.color;
  const name = typeof delta.name === 'string' ? delta.name.trim().slice(0, 80) || layer.name : layer.name;
  const nextLayer = { ...layer, ...delta, id, name, color };
  const next = { ...workspace, layers: workspace.layers.map((item) => item.id === id ? nextLayer : item) };
  if (delta.color && color !== layer.color) next.entities = workspace.entities.map((entity) => entity.layerId === id && entity.color.toLowerCase() === layer.color.toLowerCase() ? { ...entity, color } : entity);
  if (delta.visible === false || delta.locked === true) next.selectedEntityIds = workspace.selectedEntityIds.filter((entityId) => workspace.entities.find((entity) => entity.id === entityId)?.layerId !== id);
  if (workspace.activeLayerId === id && (nextLayer.visible === false || nextLayer.locked)) {
    next.activeLayerId = next.layers.find((item) => item.id !== id && item.visible && !item.locked)?.id ?? id;
  }
  return next;
}

export function deleteCadLayer(workspace: CadWorkspaceState, id: string): CadWorkspaceState {
  if (workspace.layers.length <= 1) return workspace;
  const layer = getCadLayer(workspace, id);
  if (!layer || layer.locked) return workspace;
  const fallback = workspace.layers.find((item) => item.id !== id && item.visible && !item.locked)
    ?? workspace.layers.find((item) => item.id !== id)!;
  const movedIds = new Set(workspace.entities.filter((entity) => entity.layerId === id).map((entity) => entity.id));
  return {
    ...workspace,
    activeLayerId: workspace.activeLayerId === id ? fallback.id : workspace.activeLayerId,
    layers: workspace.layers.filter((item) => item.id !== id),
    entities: workspace.entities.map((entity) => entity.layerId === id ? { ...entity, layerId: fallback.id, color: fallback.color } : entity),
    blocks: workspace.blocks,
    selectedEntityIds: workspace.selectedEntityIds.filter((entityId) => !movedIds.has(entityId) || !fallback.locked),
  };
}

export function assignCadEntitiesToLayer(workspace: CadWorkspaceState, ids: string[], layerId: string): CadWorkspaceState {
  const layer = getCadLayer(workspace, layerId);
  if (!layer || layer.locked || !layer.visible) return workspace;
  const editable = new Set(editableCadEntityIds(workspace, expandCadBlockSelection(workspace, ids)));
  if (!editable.size) return workspace;
  return { ...workspace, entities: workspace.entities.map((entity) => editable.has(entity.id) ? { ...entity, layerId, color: layer.color } : entity) };
}

export function createCadBlock(workspace: CadWorkspaceState, ids: string[], id: string, name: string): CadWorkspaceState {
  const members = editableCadEntityIds(workspace, expandCadBlockSelection(workspace, ids));
  if (!members.length || workspace.blocks.some((block) => block.id === id)) return workspace;
  return { ...workspace, blocks: [...workspace.blocks, { id, name: name.trim().slice(0, 80) || `Block ${workspace.blocks.length + 1}`, entityIds: members, dynamic: true }], selectedEntityIds: members };
}

export function entityAnchor(entity: CadEntity): CadPoint {
  if (entity.kind === 'circle') return entity.center;
  return { x: (entity.start.x + entity.end.x) / 2, y: (entity.start.y + entity.end.y) / 2 };
}

export function alignCadEntities(workspace: CadWorkspaceState, ids: string[], target: CadPoint): CadWorkspaceState {
  const editable = new Set(editableCadEntityIds(workspace, expandCadBlockSelection(workspace, ids)));
  const selectedEntities = workspace.entities.filter((entity) => editable.has(entity.id));
  if (!selectedEntities.length) return workspace;
  const anchors = selectedEntities.map(entityAnchor);
  const center = { x: anchors.reduce((sum, point) => sum + point.x, 0) / anchors.length, y: anchors.reduce((sum, point) => sum + point.y, 0) / anchors.length };
  const delta = { x: target.x - center.x, y: target.y - center.y };
  return { ...workspace, entities: workspace.entities.map((entity) => editable.has(entity.id) ? translateCadEntity(entity, delta) : entity) };
}

export function matchCadProperties(workspace: CadWorkspaceState, sourceId: string, targetIds: string[]): CadWorkspaceState {
  const source = workspace.entities.find((entity) => entity.id === sourceId);
  const sourceLayer = source && getCadLayer(workspace, source.layerId);
  if (!source || !sourceLayer?.visible || sourceLayer.locked) return workspace;
  const targets = new Set(editableCadEntityIds(workspace, expandCadBlockSelection(workspace, targetIds)).filter((id) => id !== sourceId));
  return { ...workspace, entities: workspace.entities.map((entity) => targets.has(entity.id) ? { ...entity, layerId: source.layerId, color: source.color } : entity) };
}

function intersectionParameters(target: CadSegmentEntity, boundary: CadEntity, constrainTarget: boolean): number[] {
  if (boundary.kind === 'circle') return lineCircleIntersections(target.start, target.end, boundary, constrainTarget).map((point) => parameterOnLine(point, target.start, target.end));
  const point = lineLineIntersection(target.start, target.end, boundary.start, boundary.end, constrainTarget, true);
  return point ? [parameterOnLine(point, target.start, target.end)] : [];
}

export function trimCadEntity(workspace: CadWorkspaceState, id: string, pick: CadPoint): CadWorkspaceState {
  const target = workspace.entities.find((entity): entity is CadSegmentEntity => entity.id === id && entity.kind !== 'circle');
  if (!target || !isCadEntityEditable(workspace, target)) return workspace;
  const parameters = workspace.entities.filter((entity) => entity.id !== id && getCadLayer(workspace, entity.layerId)?.visible !== false)
    .flatMap((boundary) => intersectionParameters(target, boundary, true))
    .filter((t) => t > 1e-6 && t < 1 - 1e-6);
  if (!parameters.length) return workspace;
  const pickT = clamp(parameterOnLine(pick, target.start, target.end), 0, 1);
  const boundaryT = parameters.reduce((best, value) => Math.abs(value - pickT) < Math.abs(best - pickT) ? value : best, parameters[0]);
  const replacement = pickT <= boundaryT ? { ...target, start: lerp(target.start, target.end, boundaryT) } : { ...target, end: lerp(target.start, target.end, boundaryT) };
  return { ...workspace, entities: workspace.entities.map((entity) => entity.id === id ? replacement : entity), selectedEntityIds: [id] };
}

export function extendCadEntity(workspace: CadWorkspaceState, id: string, pick: CadPoint): CadWorkspaceState {
  const target = workspace.entities.find((entity): entity is CadSegmentEntity => entity.id === id && entity.kind !== 'circle');
  if (!target || !isCadEntityEditable(workspace, target)) return workspace;
  const extendStart = distance(pick, target.start) <= distance(pick, target.end);
  const parameters = workspace.entities.filter((entity) => entity.id !== id && getCadLayer(workspace, entity.layerId)?.visible !== false)
    .flatMap((boundary) => intersectionParameters(target, boundary, false))
    .filter((t) => extendStart ? t < -1e-6 : t > 1 + 1e-6)
    .filter((t) => { const point = lerp(target.start, target.end, t); return point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1; });
  if (!parameters.length) return workspace;
  const chosen = parameters.reduce((best, value) => extendStart ? Math.max(best, value) : Math.min(best, value), parameters[0]);
  const replacement = extendStart ? { ...target, start: lerp(target.start, target.end, chosen) } : { ...target, end: lerp(target.start, target.end, chosen) };
  return { ...workspace, entities: workspace.entities.map((entity) => entity.id === id ? replacement : entity), selectedEntityIds: [id] };
}

export function createArrayOffsets(workspace: CadWorkspaceState, step: CadPoint): CadPoint[] {
  if (workspace.arrayMode === 'polar') {
    const radius = Math.max(0.02, distance({ x: 0, y: 0 }, step));
    return Array.from({ length: workspace.arrayCount - 1 }, (_, index) => {
      const angle = Math.PI * 2 * (index + 1) / workspace.arrayCount;
      return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
    });
  }
  if (workspace.arrayMode === 'path') return Array.from({ length: workspace.arrayCount - 1 }, (_, index) => ({ x: step.x * (index + 1), y: step.y * (index + 1) }));
  const xStep = Math.abs(step.x) < 0.01 ? 0.06 : step.x;
  const yStep = Math.abs(step.y) < 0.01 ? 0.06 : step.y;
  const offsets: CadPoint[] = [];
  for (let row = 0; row < workspace.arrayRows; row += 1) for (let column = 0; column < workspace.arrayColumns; column += 1) if (row || column) offsets.push({ x: column * xStep, y: row * yStep });
  return offsets;
}
