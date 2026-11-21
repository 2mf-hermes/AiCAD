import { describe, expect, it } from 'vitest';
import { normalizeProject } from './projects';
import { emptyEngineeringDocument } from './geometry/document';

describe('normalizeProject', () => {
  it('opens valid geometry even when one undo snapshot is corrupt', () => {
    const engineering = emptyEngineeringDocument('3d');
    const project = normalizeProject({ engineering, engineeringHistory: [null, engineering, { schemaVersion: 999 }] });
    expect(project.engineering).toEqual(engineering);
    expect(project.engineeringHistory).toEqual([engineering]);
  });
  it('round-trips engineering geometry and undo history alongside legacy data', () => {
    const initial = emptyEngineeringDocument('3d');
    const current = structuredClone(initial);
    current.features.push({ id: 'box', name: 'Base', type: 'box', inputs: [], params: { width: 80, height: 40, depth: 12 } });
    const project = normalizeProject({ id: initial.id, name: 'Engineering', intent: { subject: 'Original' }, engineering: current, engineeringHistory: [initial] });
    const restored = normalizeProject(JSON.parse(JSON.stringify(project)));
    expect(restored.engineering).toEqual(current);
    expect(restored.engineeringHistory).toEqual([initial]);
    expect(restored.intent.subject).toBe('Original');
  });
  it('loads a minimal historic project with missing modern fields', () => {
    const project = normalizeProject({ id: 'legacy', name: 'Old drawing', intent: { subject: 'Bracket' }, history: [] });
    expect(project.id).toBe('legacy');
    expect(project.intent.subject).toBe('Bracket');
    expect(project.intent.text.renderMode).toBe('application');
    expect(project.currentId).toBeNull();
    expect(project.cadWorkspace?.layers).toHaveLength(3);
  });

  it('ignores corrupt nested content instead of leaking it into UI state', () => {
    const project = normalizeProject({ id: 17, name: null, intent: 'not-an-object', history: [{ imageRef: 9 }, { id: 'valid', imageRef: 'data:image/png;base64,aA==', width: 100, height: 80, intent: null }], currentId: 'missing', masks: [{ x: 'bad' }], showGrid: 'yes', cadWorkspace: { layers: 'bad', activeLayerId: 7, osnapModes: 'bad' } });
    expect(project.name).toBe('Untitled');
    expect(project.history).toHaveLength(1);
    expect(project.currentId).toBe('valid');
    expect(project.masks).toEqual([]);
    expect(project.showGrid).toBe(true);
    expect(project.cadWorkspace?.activeLayerId).toBe('geometry');
  });

  it('migrates legacy text/title data without invalid custom-field values', () => {
    const project = normalizeProject({ intent: { text: { renderMode: 'not-supported', title: 8, date: null, customFields: [{ key: 'Drawing No.', value: 'A-1' }, null] } } });
    expect(project.intent.text).toEqual({ renderMode: 'application', title: '', date: '', customFields: [{ key: 'Drawing No.', value: 'A-1' }, { key: '', value: '' }] });
  });

  it('repairs layer references, active layer, tools and snap modes from historic CAD data', () => {
    const project = normalizeProject({
      cadWorkspace: {
        activeTool: 'unsupported-tool',
        activeLayerId: 'removed-layer',
        layers: [
          { id: 'visible', name: 'Visible', color: '#123456', visible: true, locked: false },
          { id: 'locked', name: 'Locked', color: '#654321', visible: true, locked: true },
        ],
        osnapEnabled: false,
        osnapModes: ['endpoint', 'invalid', 'endpoint', 'intersection'],
        entities: [
          { id: 'line', kind: 'line', layerId: 'missing', color: 'invalid', start: { x: -1, y: 0.25 }, end: { x: 2, y: 0.75 } },
        ],
        selectedEntityIds: ['line', 'missing'],
      },
    });

    expect(project.cadWorkspace).toMatchObject({
      activeTool: 'select',
      activeLayerId: 'visible',
      osnapEnabled: false,
      osnapModes: ['endpoint', 'intersection'],
      selectedEntityIds: ['line'],
    });
    expect(project.cadWorkspace?.layers[1]).toMatchObject({ id: 'locked', locked: true, visible: true });
    expect(project.cadWorkspace?.entities[0]).toMatchObject({
      id: 'line', layerId: 'visible', color: '#123456', start: { x: 0, y: 0.25 }, end: { x: 1, y: 0.75 },
    });
  });

  it('round-trips a modern CAD workspace without losing persisted layer and command state', () => {
    const source = normalizeProject({
      id: 'modern',
      cadWorkspace: {
        activeTool: 'dimension', activeLayerId: 'dims', osnapEnabled: true,
        osnapModes: ['midpoint', 'center'], command: 'dim', dimensionMode: 'aligned',
        arrayMode: 'polar', arrayRows: 4, arrayColumns: 5, arrayCount: 8,
        layers: [{ id: 'dims', name: 'Dimensions', color: '#2563EB', visible: true, locked: false }],
        entities: [{ id: 'd1', kind: 'dimension', layerId: 'dims', color: '#2563EB', start: { x: 0.1, y: 0.2 }, end: { x: 0.8, y: 0.9 }, mode: 'aligned' }],
        selectedEntityIds: ['d1'],
        blocks: [{ id: 'b1', name: 'Dimension block', entityIds: ['d1'], dynamic: false }],
      },
    });
    const restored = normalizeProject(JSON.parse(JSON.stringify(source)));

    expect(restored.cadWorkspace).toEqual(source.cadWorkspace);
  });
});
