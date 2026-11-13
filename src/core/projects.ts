import { createDefaultIntent, type Artboard, type DrawingIntent, type MaskRegion } from './types';
import { normalizeTextLabels } from './textOverlay';
import { normalizeCadWorkspace, type CadWorkspaceState } from './cad';
import { normalizeReferences } from './references';
import { createSafeId } from './projectSafety';

export interface ProjectDocument {
  schemaVersion: 1;
  id: string;
  name: string;
  updatedAt: number;
  intent: DrawingIntent;
  history: Artboard[];
  currentId: string | null;
  masks: MaskRegion[];
  showGrid: boolean;
  cadWorkspace?: CadWorkspaceState;
}

export interface ProjectMeta {
  id: string;
  name: string;
  updatedAt: number;
  preview?: string;
  boards: number;
}

export interface ProjectBackend {
  readonly kind: 'native-file' | 'local-storage';
  list(): Promise<ProjectMeta[]>;
  load(id: string): Promise<ProjectDocument>;
  save(project: ProjectDocument): Promise<ProjectMeta>;
  remove(id: string): Promise<void>;
}

const INDEX_KEY = 'aicad.projects.v1';
const dataKey = (id: string) => `aicad.project.v1.${id}`;
const asRecord = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const asString = (value: unknown, fallback = '') => typeof value === 'string' ? value : fallback;
const asBoolean = (value: unknown, fallback: boolean) => typeof value === 'boolean' ? value : fallback;
const asTimestamp = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : Date.now();

function readIndex(): ProjectMeta[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(INDEX_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item): ProjectMeta | null => {
      const record = asRecord(item);
      const id = asString(record.id);
      if (!id) return null;
      return { id, name: asString(record.name, 'Untitled'), updatedAt: asTimestamp(record.updatedAt), preview: asString(record.preview) || undefined, boards: typeof record.boards === 'number' && Number.isFinite(record.boards) ? Math.max(0, record.boards) : 0 };
    }).filter((item): item is ProjectMeta => item !== null);
  } catch {
    return [];
  }
}

const localBackend: ProjectBackend = {
  kind: 'local-storage',
  async list() { return readIndex().sort((a, b) => b.updatedAt - a.updatedAt); },
  async load(id) {
    const raw = localStorage.getItem(dataKey(id));
    if (!raw) throw new Error('Project not found');
    try {
      return normalizeProject(JSON.parse(raw));
    } catch {
      throw new Error('Project file is invalid or incompatible');
    }
  },
  async save(project) {
    const preview = project.history.find((a) => a.id === project.currentId)?.imageRef ?? '';
    const meta: ProjectMeta = { id: project.id, name: project.name, updatedAt: project.updatedAt, preview, boards: project.history.length };
    localStorage.setItem(dataKey(project.id), JSON.stringify(project));
    localStorage.setItem(INDEX_KEY, JSON.stringify([meta, ...readIndex().filter((m) => m.id !== project.id)]));
    return meta;
  },
  async remove(id) {
    localStorage.removeItem(dataKey(id));
    localStorage.setItem(INDEX_KEY, JSON.stringify(readIndex().filter((m) => m.id !== id)));
  },
};

let backend: ProjectBackend = localBackend;
export function setProjectBackend(next: ProjectBackend): void { backend = next; }
export const listProjects = () => backend.list();
export const loadProject = (id: string) => backend.load(id);
export const saveProject = (project: ProjectDocument) => backend.save(project);
export const deleteProject = (id: string) => backend.remove(id);

function normalizeText(value: unknown, defaults: DrawingIntent['text']): DrawingIntent['text'] {
  const raw = asRecord(value);
  /* 只剩兩種模式；舊存檔若還寫著已移除的 'text-model-overlay'，一律收斂成應用程式精確疊加。 */
  const rawMode = raw.renderMode;
  const mode: DrawingIntent['text']['renderMode'] =
    rawMode === 'image-model'
      ? 'image-model'
      : rawMode === 'application' || rawMode === 'text-model-overlay'
        ? 'application'
        : defaults.renderMode;
  const customFields = Array.isArray(raw.customFields) ? raw.customFields.slice(0, 40).map((field: unknown) => {
    const record = asRecord(field);
    return { key: asString(record.key).slice(0, 160), value: asString(record.value).slice(0, 500) };
  }) : defaults.customFields;
  return { renderMode: mode, title: asString(raw.title).slice(0, 500), date: asString(raw.date).slice(0, 100), customFields };
}

function normalizeIntent(value: unknown, fallback: DrawingIntent): DrawingIntent {
  const raw = asRecord(value);
  const annotation = asRecord(raw.annotation);
  const measurements = asRecord(raw.measurements);
  return {
    ...fallback,
    ...raw,
    subject: asString(raw.subject, fallback.subject),
    categoryContent: asString(raw.categoryContent, fallback.categoryContent).slice(0, 2000),
    textLanguage: ['zh-Hant', 'zh-Hans', 'en', 'ja', 'ko', 'none'].includes(asString(raw.textLanguage)) ? raw.textLanguage as DrawingIntent['textLanguage'] : fallback.textLanguage,
    text: normalizeText(raw.text, fallback.text),
    measurements: Object.fromEntries(Object.entries(measurements).slice(0, 100).flatMap(([key, item]) => typeof item === 'string' ? [[key.slice(0, 160), item.slice(0, 160)]] : [])),
    annotation: { ...fallback.annotation, ...annotation, dimensions: asBoolean(annotation.dimensions, fallback.annotation.dimensions), tolerance: asBoolean(annotation.tolerance, fallback.annotation.tolerance), gdt: asBoolean(annotation.gdt, fallback.annotation.gdt), callouts: asBoolean(annotation.callouts, fallback.annotation.callouts), titleBlock: asBoolean(annotation.titleBlock, fallback.annotation.titleBlock), scaleBar: asBoolean(annotation.scaleBar, fallback.annotation.scaleBar) },
    notes: asString(raw.notes, fallback.notes),
    exclude: Array.isArray(raw.exclude) ? raw.exclude.filter((item): item is string => typeof item === 'string').slice(0, 100) : fallback.exclude,
    references: normalizeReferences(raw.references),
  };
}

function normalizeMasks(value: unknown): MaskRegion[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 100).flatMap((item): MaskRegion[] => {
    const raw = asRecord(item);
    const x = raw.x; const y = raw.y; const w = raw.w; const h = raw.h;
    if (![x, y, w, h].every((number) => typeof number === 'number' && Number.isFinite(number))) return [];
    return [{ id: asString(raw.id) || createSafeId('project'), x: Math.max(0, Math.min(1, x as number)), y: Math.max(0, Math.min(1, y as number)), w: Math.max(0, Math.min(1, w as number)), h: Math.max(0, Math.min(1, h as number)), instruction: asString(raw.instruction) }];
  });
}

function normalizeArtboard(value: unknown, intent: DrawingIntent): Artboard | null {
  const raw = asRecord(value);
  const imageRef = asString(raw.imageRef);
  if (!imageRef) return null;
  const width = raw.width; const height = raw.height;
  if (typeof width !== 'number' || !Number.isFinite(width) || width <= 0 || typeof height !== 'number' || !Number.isFinite(height) || height <= 0) return null;
  return { id: asString(raw.id) || createSafeId('project'), createdAt: asTimestamp(raw.createdAt), imageRef, width, height, intent: normalizeIntent(raw.intent, intent), parentId: asString(raw.parentId) || undefined, masks: normalizeMasks(raw.masks), resolvedPrompt: asString(raw.resolvedPrompt), providerId: asString(raw.providerId, 'legacy'), model: asString(raw.model, '(legacy)'), textLabels: normalizeTextLabels(raw.textLabels) };
}

/** Safely migrates historic project documents before any UI state is updated. */
export function normalizeProject(value: unknown): ProjectDocument {
  const raw = asRecord(value);
  const defaults = createDefaultIntent();
  const intent = normalizeIntent(raw.intent, defaults);
  const history = Array.isArray(raw.history) ? raw.history.slice(0, 40).map((board) => normalizeArtboard(board, intent)).filter((board): board is Artboard => board !== null) : [];
  const requestedCurrentId = asString(raw.currentId) || null;
  const currentId = requestedCurrentId && history.some((board) => board.id === requestedCurrentId) ? requestedCurrentId : history[0]?.id ?? null;
  return {
    schemaVersion: 1,
    id: asString(raw.id) || createSafeId('project'),
    name: asString(raw.name, 'Untitled').slice(0, 200),
    updatedAt: asTimestamp(raw.updatedAt),
    intent,
    history,
    currentId,
    masks: normalizeMasks(raw.masks),
    showGrid: asBoolean(raw.showGrid, true),
    cadWorkspace: normalizeCadWorkspace(asRecord(raw.cadWorkspace)),
  };
}
