import { describe, expect, it } from 'vitest';
import {
  addCadLayer, alignCadEntities, assignCadEntitiesToLayer, cadSnapCandidates, cadSnapCandidatesForModes, cadToleranceForViewport, createArrayOffsets, createCadEntity,
  createCadRectangle, createDefaultCadWorkspace, deleteCadEntities, extendCadEntity, findCadSnap,
  findNearestCadEntity, matchCadProperties, normalizeCadWorkspace, offsetCadEntity, resolveCadCommand,
  snapCadPoint, translateCadEntity, trimCadEntity, updateCadLayer,
  type CadEntity,
} from './cad';

describe('CAD workspace', () => {
  it('creates professional CAD defaults', () => {
    const workspace = createDefaultCadWorkspace();
    expect(workspace.activeTool).toBe('select');
    expect(workspace.activeLayerId).toBe('geometry');
    expect(workspace.osnapEnabled).toBe(true);
    expect(workspace.osnapModes).toEqual(['endpoint', 'midpoint', 'center', 'quadrant', 'intersection']);
    expect(workspace.dimensionMode).toBe('linear');
    expect(workspace.arrayMode).toBe('rectangular');
    expect(workspace.layers.map((layer) => layer.id)).toEqual(['geometry', 'dimension', 'annotation']);
    expect(workspace.entities).toEqual([]);
  });

  it('applies the typed dimension value to new dimensions', () => {
    const workspace = { ...createDefaultCadWorkspace(), dimensionText: '12.5' };
    const dimension = createCadEntity(workspace, 'dimension', { x: .1, y: .1 }, { x: .5, y: .1 }, 'dim');
    expect(dimension).toMatchObject({ kind: 'dimension', text: '12.5' });
    const auto = createCadEntity({ ...workspace, dimensionText: '   ' }, 'dimension', { x: .1, y: .1 }, { x: .5, y: .1 }, 'dim-auto');
    expect(auto).toMatchObject({ kind: 'dimension' });
    expect((auto as { text?: string }).text).toBeUndefined();
  });

  it('keeps dimension text overrides through persistence normalization', () => {
    const workspace = normalizeCadWorkspace({
      dimensionText: '  25  ',
      entities: [{ id: 'd', kind: 'dimension', layerId: 'geometry', color: '#000000', start: { x: 0, y: 0 }, end: { x: .4, y: 0 }, mode: 'linear', text: '25±0.1' }],
    });
    expect(workspace.dimensionText).toBe('25');
    expect(workspace.entities[0]).toMatchObject({ kind: 'dimension', text: '25±0.1' });
  });

  it('bounds array offsets to the configured counts', () => {
    const rectangular = { ...createDefaultCadWorkspace(), arrayMode: 'rectangular' as const, arrayRows: 20, arrayColumns: 20 };
    expect(createArrayOffsets(rectangular, { x: .05, y: .05 })).toHaveLength(399);
    const polar = { ...createDefaultCadWorkspace(), arrayMode: 'polar' as const, arrayCount: 36 };
    expect(createArrayOffsets(polar, { x: .05, y: .05 })).toHaveLength(35);
  });

  it('falls back to a valid active layer when persisted state references a missing layer', () => {
    const workspace = normalizeCadWorkspace({ activeLayerId: 'missing', layers: [{ id: 'custom', name: 'Custom', color: '#FFFFFF', visible: true, locked: false }] });
    expect(workspace.activeLayerId).toBe('custom');
  });

  it('migrates older workspaces and rejects unknown osnap modes', () => {
    const workspace = normalizeCadWorkspace({ osnapModes: ['endpoint', 'bad-mode' as never] });
    expect(workspace.dimensionMode).toBe('linear');
    expect(workspace.blocks).toEqual([]);
    expect(workspace.entities).toEqual([]);
    expect(workspace.osnapModes).toEqual(['endpoint']);
  });

  it.each([['L', 'line'], ['REC', 'rectangle'], ['C', 'circle'], ['E', 'erase'], ['CO', 'copy'], ['M', 'move'], ['DIM', 'dimension'], ['TR', 'trim'], ['EX', 'extend'], ['O', 'offset'], ['RO', 'rotate'], ['MI', 'mirror'], ['B', 'block'], ['AR', 'array'], ['AL', 'align'], ['MA', 'matchprop']])('resolves command %s', (command, expected) => {
    expect(resolveCadCommand(command)).toBe(expected);
  });

  it('snaps to the nearest point within tolerance', () => {
    expect(snapCadPoint({ x: 0.2, y: 0.2 }, [{ x: 0.21, y: 0.2 }, { x: 0.8, y: 0.8 }], 0.02)).toEqual({ x: 0.21, y: 0.2 });
    expect(snapCadPoint({ x: 0.2, y: 0.2 }, [{ x: 0.3, y: 0.3 }], 0.02)).toEqual({ x: 0.2, y: 0.2 });
  });

  it('keeps screen-space hit tolerance bounded as the viewport changes', () => {
    expect(cadToleranceForViewport(1000, 800, 12)).toBeCloseTo(.015);
    expect(cadToleranceForViewport(4000, 3000, 12)).toBeCloseTo(.004);
    expect(cadToleranceForViewport(100, 80, 12)).toBe(.035);
  });

  it('assigns editable entities to a visible unlocked layer', () => {
    const line: CadEntity = { id: 'line', kind: 'line', layerId: 'geometry', color: '#2D3138', start: { x: .1, y: .2 }, end: { x: .8, y: .2 } };
    const workspace = addCadLayer({ ...createDefaultCadWorkspace(), entities: [line], selectedEntityIds: [line.id] }, { id: 'details', name: 'Details', color: '#123456', visible: true, locked: false });
    expect(assignCadEntitiesToLayer(workspace, [line.id], 'details').entities[0]).toMatchObject({ layerId: 'details', color: '#123456' });
    const locked = updateCadLayer(workspace, 'details', { locked: true });
    expect(assignCadEntitiesToLayer(locked, [line.id], 'details')).toBe(locked);
  });

  it('honors enabled osnap modes and calculates intersections', () => {
    const first: CadEntity = { id: 'a', kind: 'line', layerId: 'geometry', color: '#ffffff', start: { x: 0, y: 0 }, end: { x: 1, y: 1 } };
    const second: CadEntity = { id: 'b', kind: 'line', layerId: 'geometry', color: '#ffffff', start: { x: 0, y: 1 }, end: { x: 1, y: 0 } };
    expect(cadSnapCandidatesForModes([first], ['midpoint'])).toEqual([{ x: .5, y: .5 }]);
    expect(cadSnapCandidatesForModes([first, second], ['intersection'])).toEqual([{ x: .5, y: .5 }]);
  });

  it('supports line-circle, circle-circle and quadrant snaps with mode indicators', () => {
    const line: CadEntity = { id: 'line', kind: 'line', layerId: 'geometry', color: '#ffffff', start: { x: 0, y: .5 }, end: { x: 1, y: .5 } };
    const circle: CadEntity = { id: 'circle', kind: 'circle', layerId: 'geometry', color: '#ffffff', center: { x: .5, y: .5 }, radius: .25 };
    const circle2: CadEntity = { id: 'circle-2', kind: 'circle', layerId: 'geometry', color: '#ffffff', center: { x: .8, y: .5 }, radius: .25 };
    expect(cadSnapCandidatesForModes([circle], ['quadrant'])).toEqual(expect.arrayContaining([{ x: .75, y: .5 }, { x: .25, y: .5 }]));
    expect(cadSnapCandidatesForModes([line, circle], ['intersection'])).toEqual(expect.arrayContaining([{ x: .25, y: .5 }, { x: .75, y: .5 }]));
    expect(cadSnapCandidatesForModes([circle, circle2], ['intersection'])).toHaveLength(2);
    expect(findCadSnap({ x: .751, y: .5 }, [circle], ['quadrant'], .01)).toMatchObject({ x: .75, y: .5, mode: 'quadrant' });
  });

  it('creates, selects, translates and deletes real canvas entities', () => {
    const workspace = createDefaultCadWorkspace();
    const line = createCadEntity(workspace, 'line', { x: .1, y: .2 }, { x: .8, y: .2 }, 'line-1');
    expect(line?.kind).toBe('line');
    const circle = createCadEntity(workspace, 'circle', { x: .5, y: .5 }, { x: .6, y: .5 }, 'circle-1');
    expect(circle?.kind).toBe('circle');
    const entities = [line, circle].filter((entity): entity is CadEntity => entity !== null);
    expect(findNearestCadEntity(entities, { x: .4, y: .205 })?.id).toBe('line-1');
    expect(cadSnapCandidates(entities)).toContainEqual({ x: .45, y: .2 });
    const moved = translateCadEntity(line!, { x: .1, y: .1 });
    expect(moved.kind).toBe('line');
    if (moved.kind !== 'line') throw new Error('Expected line');
    expect(moved.start.x).toBeCloseTo(.2);
    expect(moved.start.y).toBeCloseTo(.3);
    const next = deleteCadEntities({ ...workspace, entities, selectedEntityIds: ['line-1'] }, ['line-1']);
    expect(next.entities.map((entity) => entity.id)).toEqual(['circle-1']);
    expect(next.selectedEntityIds).toEqual([]);
  });

  it('normalizes persisted entities and removes dangling selection', () => {
    const workspace = normalizeCadWorkspace({
      entities: [{ id: 'ok', kind: 'line', layerId: 'geometry', color: '#ffffff', start: { x: -1, y: .2 }, end: { x: 2, y: .8 } }],
      selectedEntityIds: ['ok', 'missing'],
    });
    expect(workspace.entities).toHaveLength(1);
    expect(workspace.entities[0]).toMatchObject({ start: { x: 0, y: .2 }, end: { x: 1, y: .8 } });
    expect(workspace.selectedEntityIds).toEqual(['ok']);
  });

  it('prevents drawing, deletion and modification on locked layers', () => {
    const line: CadEntity = { id: 'locked-line', kind: 'line', layerId: 'geometry', color: '#ffffff', start: { x: .1, y: .2 }, end: { x: .8, y: .2 } };
    const workspace = updateCadLayer({ ...createDefaultCadWorkspace(), entities: [line], selectedEntityIds: [line.id] }, 'geometry', { locked: true });
    expect(createCadEntity({ ...workspace, activeLayerId: 'geometry' }, 'line', { x: .1, y: .1 }, { x: .2, y: .2 }, 'new')).toBeNull();
    expect(deleteCadEntities(workspace, [line.id])).toBe(workspace);
    expect(alignCadEntities(workspace, [line.id], { x: .5, y: .5 })).toBe(workspace);
    expect(matchCadProperties(workspace, line.id, [line.id]).entities).toEqual([line]);
  });

  it('clears selections when a layer is hidden and preserves custom colors', () => {
    const line: CadEntity = { id: 'line', kind: 'line', layerId: 'geometry', color: '#ff0000', start: { x: .1, y: .2 }, end: { x: .8, y: .2 } };
    const workspace = updateCadLayer({ ...createDefaultCadWorkspace(), entities: [line], selectedEntityIds: [line.id] }, 'geometry', { visible: false, color: '#00ff00' });
    expect(workspace.selectedEntityIds).toEqual([]);
    expect(workspace.entities[0].color).toBe('#ff0000');
  });

  it('recovers the current layer when it becomes hidden or locked', () => {
    const hidden = updateCadLayer(createDefaultCadWorkspace(), 'geometry', { visible: false });
    expect(hidden.activeLayerId).toBe('dimension');
    const locked = updateCadLayer(createDefaultCadWorkspace(), 'geometry', { locked: true });
    expect(locked.activeLayerId).toBe('dimension');
    const normalized = normalizeCadWorkspace({
      activeLayerId: 'geometry',
      layers: [
        { id: 'geometry', name: 'Geometry', color: '#2D3138', visible: true, locked: true },
        { id: 'detail', name: 'Detail', color: '#2563EB', visible: true, locked: false },
      ],
    });
    expect(normalized.activeLayerId).toBe('detail');
  });

  it('does not restore hidden or locked entities as selected', () => {
    const entities: CadEntity[] = [
      { id: 'hidden', kind: 'line', layerId: 'hidden-layer', color: '#ffffff', start: { x: .1, y: .1 }, end: { x: .2, y: .2 } },
      { id: 'locked', kind: 'line', layerId: 'locked-layer', color: '#ffffff', start: { x: .2, y: .2 }, end: { x: .3, y: .3 } },
    ];
    const workspace = normalizeCadWorkspace({
      layers: [
        { id: 'hidden-layer', name: 'Hidden', color: '#ffffff', visible: false, locked: false },
        { id: 'locked-layer', name: 'Locked', color: '#ffffff', visible: true, locked: true },
      ],
      entities,
      selectedEntityIds: ['hidden', 'locked'],
    });
    expect(workspace.selectedEntityIds).toEqual([]);
  });

  it('adds layers and creates four-sided rectangles', () => {
    const workspace = addCadLayer(createDefaultCadWorkspace(), { id: 'details', name: 'Details', color: '#123456', visible: true, locked: false });
    expect(workspace.activeLayerId).toBe('details');
    const rectangle = createCadRectangle(workspace, { x: .1, y: .2 }, { x: .5, y: .6 }, ['a', 'b', 'c', 'd']);
    expect(rectangle).toHaveLength(4);
    expect(rectangle.every((entity) => entity.layerId === 'details')).toBe(true);
  });

  it('trims and extends lines against visible boundaries', () => {
    const target: CadEntity = { id: 'target', kind: 'line', layerId: 'geometry', color: '#ffffff', start: { x: .1, y: .5 }, end: { x: .9, y: .5 } };
    const boundary: CadEntity = { id: 'boundary', kind: 'line', layerId: 'geometry', color: '#ffffff', start: { x: .4, y: .2 }, end: { x: .4, y: .8 } };
    const base = { ...createDefaultCadWorkspace(), entities: [target, boundary] };
    const trimmed = trimCadEntity(base, target.id, { x: .2, y: .5 });
    expect((trimmed.entities[0] as typeof target & { start: { x: number } }).start.x).toBeCloseTo(.4);
    const short: CadEntity = { ...target, end: { x: .3, y: .5 } };
    const extended = extendCadEntity({ ...base, entities: [short, boundary] }, target.id, { x: .3, y: .5 });
    expect((extended.entities[0] as typeof target & { end: { x: number } }).end.x).toBeCloseTo(.4);
  });

  it('offsets line and circle geometry without mutating the source', () => {
    const line: CadEntity = { id: 'line', kind: 'line', layerId: 'geometry', color: '#ffffff', start: { x: .1, y: .2 }, end: { x: .8, y: .2 } };
    const circle: CadEntity = { id: 'circle', kind: 'circle', layerId: 'geometry', color: '#ffffff', center: { x: .5, y: .5 }, radius: .1 };
    expect(offsetCadEntity(line, .05, 'line-copy')).toMatchObject({ id: 'line-copy', start: { y: .25 }, end: { y: .25 } });
    const offsetCircle = offsetCadEntity(circle, .05, 'circle-copy');
    expect(offsetCircle?.id).toBe('circle-copy');
    expect(offsetCircle?.kind === 'circle' ? offsetCircle.radius : 0).toBeCloseTo(.15);
    expect(line).toMatchObject({ id: 'line', start: { y: .2 } });
  });
});
