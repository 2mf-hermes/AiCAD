export type Scalar = number | string;
export type GeometryMode = '3d' | '2d';
export interface GeometryFeature {
  id: string;
  name: string;
  type: 'box' | 'cylinder' | 'sphere' | 'extrude' | 'union' | 'cut' | 'intersect' | 'fillet' | 'chamfer' | 'translate';
  params: Record<string, Scalar>;
  inputs: string[];
  suppressed?: boolean;
}
export interface VectorEntity {
  id: string;
  type: 'line' | 'circle' | 'rect' | 'arc' | 'text';
  layer: string;
  params: Record<string, Scalar>;
  text?: string;
}
export interface EngineeringSettings {
  units: 'mm' | 'in';
  precision: number;
  upAxis: 'Y' | 'Z';
  tolerance: number;
  meshTolerance: number;
  density: number;
  material: string;
  standard: 'ISO' | 'JIS' | 'ASME' | 'CNS';
  projection: 'first' | 'third';
  paper: 'A4' | 'A3' | 'A2' | 'A1' | 'A0';
  scale: number;
  title: string;
  partNumber: string;
  revision: string;
  generalTolerance: string;
}
export interface EngineeringDocument {
  schemaVersion: 1;
  id: string;
  name: string;
  mode: GeometryMode;
  parameters: Record<string, Scalar>;
  features: GeometryFeature[];
  entities: VectorEntity[];
  settings: EngineeringSettings;
}
export const defaultEngineeringSettings: EngineeringSettings = {
  units: 'mm', precision: 2, upAxis: 'Z', tolerance: 0.001, meshTolerance: 0.1,
  density: 2.7, material: 'AL6061-T6', standard: 'ISO', projection: 'third',
  paper: 'A4', scale: 1, title: '', partNumber: '', revision: 'A', generalTolerance: 'ISO 2768-mK',
};
export function emptyEngineeringDocument(mode: GeometryMode): EngineeringDocument {
  return { schemaVersion: 1, id: crypto.randomUUID(), name: 'Untitled', mode, parameters: {}, features: [], entities: [], settings: { ...defaultEngineeringSettings } };
}

/** Restricted arithmetic grammar. No eval, property access, calls or executable code. */
export function resolveScalar(value: Scalar | undefined, parameters: Record<string, Scalar>, stack: string[] = []): number {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Math.abs(value) > 1e7) throw new Error('Parameter outside supported range');
    return value;
  }
  if (typeof value !== 'string' || value.length > 200) throw new Error('Missing or invalid parameter');
  const source = value.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, '$1');
  const tokens = source.match(/(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[A-Za-z_][A-Za-z0-9_]*|[()+*/-]/g) ?? [];
  if (tokens.join('') !== source.replace(/\s/g, '') || tokens.length > 100) throw new Error('Invalid parameter expression');
  let index = 0;
  function atom(): number {
    const token = tokens[index++];
    if (token === '-') return -atom();
    if (token === '+') return atom();
    if (token === '(') { const result = sum(); if (tokens[index++] !== ')') throw new Error('Unbalanced expression'); return result; }
    if (/^[A-Za-z_]/.test(token ?? '')) {
      if (stack.includes(token) || stack.length > 30 || !Object.hasOwn(parameters, token)) throw new Error(`Invalid parameter dependency: ${token}`);
      return resolveScalar(parameters[token], parameters, [...stack, token]);
    }
    if (!token || !Number.isFinite(Number(token))) throw new Error('Invalid number');
    return Number(token);
  }
  function product(): number { let n = atom(); while (tokens[index] === '*' || tokens[index] === '/') { const op = tokens[index++]; const b = atom(); n = op === '*' ? n * b : n / b; } return n; }
  function sum(): number { let n = product(); while (tokens[index] === '+' || tokens[index] === '-') { const op = tokens[index++]; const b = product(); n = op === '+' ? n + b : n - b; } return n; }
  const result = sum();
  if (index !== tokens.length) throw new Error('Unexpected expression token');
  return resolveScalar(result, {});
}
const types = new Set(['box', 'cylinder', 'sphere', 'extrude', 'union', 'cut', 'intersect', 'fillet', 'chamfer', 'translate']);
const vectorTypes = new Set(['line', 'circle', 'rect', 'arc', 'text']);
export function validateEngineeringDocument(value: unknown): EngineeringDocument {
  if (!value || typeof value !== 'object') throw new Error('Expected geometry document');
  const doc = structuredClone(value) as EngineeringDocument;
  if (doc.schemaVersion !== 1 || !['3d', '2d'].includes(doc.mode) || typeof doc.id !== 'string' || typeof doc.name !== 'string') throw new Error('Invalid geometry document header');
  if (!doc.parameters || typeof doc.parameters !== 'object' || Array.isArray(doc.parameters) || Object.keys(doc.parameters).length > 200) throw new Error('Invalid parameters');
  for (const [key, val] of Object.entries(doc.parameters)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key)) throw new Error('Invalid parameter name');
    resolveScalar(val, doc.parameters, [key]);
  }
  if (!Array.isArray(doc.features) || doc.features.length > 150 || !Array.isArray(doc.entities) || doc.entities.length > 2000) throw new Error('Geometry budget exceeded');
  if (!doc.settings || !['mm', 'in'].includes(doc.settings.units)) throw new Error('Invalid units');
  const settings = { ...defaultEngineeringSettings, ...doc.settings };
  if (!['Y', 'Z'].includes(settings.upAxis) || !['ISO', 'JIS', 'ASME', 'CNS'].includes(settings.standard) || !['first', 'third'].includes(settings.projection) || !['A0', 'A1', 'A2', 'A3', 'A4'].includes(settings.paper)) throw new Error('Invalid engineering standard');
  for (const key of ['material', 'title', 'partNumber', 'revision', 'generalTolerance'] as const) if (typeof settings[key] !== 'string' || settings[key].length > 1000) throw new Error(`Invalid metadata: ${key}`);
  for (const key of ['precision', 'tolerance', 'meshTolerance', 'density', 'scale'] as const) if (typeof settings[key] !== 'number' || !Number.isFinite(settings[key])) throw new Error(`Invalid setting: ${key}`);
  if (!Number.isInteger(settings.precision) || settings.precision < 0 || settings.precision > 6 || settings.meshTolerance < 0.01 || settings.meshTolerance > 5 || settings.tolerance <= 0 || settings.density <= 0 || settings.scale <= 0) throw new Error('Settings outside supported range');
  doc.settings = settings;
  const seen = new Set<string>();
  for (const item of [...doc.features, ...doc.entities]) {
    if (!item || typeof item.id !== 'string' || !/^[\w.-]{1,100}$/.test(item.id) || seen.has(item.id)) throw new Error('Invalid or duplicate geometry ID');
    if (!item.params || typeof item.params !== 'object' || Array.isArray(item.params) || Object.keys(item.params).length > 30) throw new Error('Invalid feature parameters');
    for (const val of Object.values(item.params)) resolveScalar(val, doc.parameters);
    if ('inputs' in item) {
      if (!types.has(item.type) || !Array.isArray(item.inputs) || item.inputs.some(id => !seen.has(id))) throw new Error(`Invalid feature dependency: ${item.id}`);
      const arity = ['union', 'cut', 'intersect'].includes(item.type) ? 2 : ['fillet', 'chamfer', 'translate'].includes(item.type) ? 1 : 0;
      if (item.inputs.length !== arity || typeof item.name !== 'string' || (item.suppressed !== undefined && typeof item.suppressed !== 'boolean')) throw new Error('Invalid feature definition');
    } else {
      if (!vectorTypes.has(item.type) || typeof item.layer !== 'string' || item.layer.length > 100 || (item.text !== undefined && (typeof item.text !== 'string' || item.text.length > 5000))) throw new Error('Invalid vector entity');
      const required = { line: ['x1', 'y1', 'x2', 'y2'], circle: ['x', 'y', 'radius'], rect: ['x', 'y', 'width', 'height'], arc: ['x', 'y', 'radius', 'startAngle', 'endAngle'], text: ['x', 'y', 'height'] }[item.type];
      for (const key of required) resolveScalar(item.params[key], doc.parameters);
      for (const key of ['radius', 'width', 'height']) if (key in item.params && resolveScalar(item.params[key], doc.parameters) <= 0) throw new Error('Invalid vector size');
    }
    seen.add(item.id);
  }
  return doc;
}
export function protectLocalEdit(previous: EngineeringDocument, next: EngineeringDocument, selected: string[]): void {
  if (!selected.length) throw new Error('Select geometry before local editing');
  if (next.mode !== previous.mode || JSON.stringify(next.settings) !== JSON.stringify(previous.settings) || JSON.stringify(next.parameters) !== JSON.stringify(previous.parameters)) throw new Error('Local edits cannot change document settings or shared parameters');
  const allowed = new Set(selected);
  for (const field of ['features', 'entities'] as const) {
    const oldItems = previous[field]; const newItems = next[field];
    for (const item of oldItems) if (!allowed.has(item.id) && JSON.stringify(item) !== JSON.stringify(newItems.find(candidate => candidate.id === item.id))) throw new Error(`Local edit changed unselected geometry: ${item.id}`);
    const additions = newItems.filter(item => !oldItems.some(old => old.id === item.id));
    if (field === 'entities' && additions.length && !previous.entities.some(item => allowed.has(item.id))) throw new Error('Select drawing geometry before adding local entities');
    if (field === 'features' && additions.length) {
      const connected = new Set(allowed);
      // A new tool body is allowed only when consumed by a feature connected to the selection.
      for (let pass = 0; pass <= additions.length; pass++) for (const item of additions as GeometryFeature[]) {
        if (item.inputs.some(id => connected.has(id))) { connected.add(item.id); item.inputs.forEach(id => connected.add(id)); }
      }
      if (additions.some(item => !connected.has(item.id))) throw new Error('New features must belong to the selected feature chain');
      for (const item of additions as GeometryFeature[]) if (item.inputs.some(id => oldItems.some(old => old.id === id) && !allowed.has(id))) throw new Error('Local edit consumed unselected geometry');
    }
    if (oldItems.filter(item => !allowed.has(item.id)).map(item => item.id).join('|') !== newItems.filter(item => !allowed.has(item.id) && oldItems.some(old => old.id === item.id)).map(item => item.id).join('|')) throw new Error('Local edit reordered dependencies');
  }
}
