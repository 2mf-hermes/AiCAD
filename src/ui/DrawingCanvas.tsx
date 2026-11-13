import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Artboard, MaskRegion } from '../core/types';
import type { FurniturePrimitive } from '../core/sheetFurniture';
import {
  alignCadEntities, cadToleranceForViewport, createArrayOffsets, createCadBlock, createCadEntity, createCadRectangle,
  deleteCadEntities, editableCadEntityIds, entityAnchor, expandCadBlockSelection, extendCadEntity, findCadSnap,
  findNearestCadEntity, isCadEntityEditable, matchCadProperties, MAX_CAD_ENTITIES, mirrorCadEntity, offsetCadEntity,
  rotateCadEntity, translateCadEntity, trimCadEntity,
  type CadEntity, type CadPoint, type CadSnapResult, type CadTool, type CadWorkspaceState,
} from '../core/cad';
import { createSafeId } from '../core/projectSafety';
import { arrowLines, dimensionGeometry } from '../core/dimension';
import { LABEL_FONT_STACK, placeLabels, shouldOverlayLabels } from '../core/textOverlay';

interface Props {
  artboard: Artboard | null;
  ratio: number;
  masks: MaskRegion[];
  /** 由 sheetFurniture 產生的圖框圖元；與匯出用同一份幾何。 */
  furniture: readonly FurniturePrimitive[];
  /** 圖框座標系高度（viewBox 0 0 1000 furnitureHeight）。 */
  furnitureHeight: number;
  showGrid: boolean;
  maskMode: boolean;
  zoomBoxMode: boolean;
  cadWorkspace: CadWorkspaceState;
  onCadWorkspaceChange: (next: CadWorkspaceState) => void;
  onZoomBoxModeChange: (active: boolean) => void;
  onAddMask: (region: Omit<MaskRegion, 'id' | 'instruction'>) => void;
}

interface Draft { x0: number; y0: number; x1: number; y1: number; }
interface CadDraft { start: CadPoint; end: CadPoint; }
interface ContextMenuState { x: number; y: number; point: CadPoint; entityId?: string; }
const MIN_SIZE = 0.015;
const DRAW_TOOLS: CadTool[] = ['line', 'rectangle', 'circle', 'dimension'];

export function DrawingCanvas({
  artboard, ratio, masks, furniture, furnitureHeight, showGrid, maskMode, zoomBoxMode,
  cadWorkspace, onCadWorkspaceChange, onZoomBoxModeChange, onAddMask,
}: Props) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const historyRef = useRef<CadWorkspaceState[]>([]);
  const redoRef = useRef<CadWorkspaceState[]>([]);
  const dragEntityRef = useRef<{ mode: 'move' | 'copy'; start: CadPoint; originals: CadEntity[]; before: CadWorkspaceState; cloneIds?: string[] } | null>(null);
  const operationSourceRef = useRef<{ tool: 'matchprop'; entityId: string } | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [cadDraft, setCadDraft] = useState<CadDraft | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [snapPoint, setSnapPoint] = useState<CadSnapResult | null>(null);
  const [zoom, setZoom] = useState(1);
  const visibleEntities = useMemo(() => cadWorkspace.entities.filter((entity) => cadWorkspace.layers.find((layer) => layer.id === entity.layerId)?.visible !== false), [cadWorkspace.entities, cadWorkspace.layers]);
  const selected = new Set(cadWorkspace.selectedEntityIds);

  const commitWorkspace = useCallback((next: CadWorkspaceState) => {
    historyRef.current = [...historyRef.current.slice(-49), cadWorkspace];
    redoRef.current = [];
    onCadWorkspaceChange(next);
  }, [cadWorkspace, onCadWorkspaceChange]);
  const undo = useCallback(() => {
    const previous = historyRef.current.pop();
    if (!previous) return;
    redoRef.current.push(cadWorkspace);
    onCadWorkspaceChange(previous);
  }, [cadWorkspace, onCadWorkspaceChange]);
  const redo = useCallback(() => {
    const next = redoRef.current.pop();
    if (!next) return;
    historyRef.current.push(cadWorkspace);
    onCadWorkspaceChange(next);
  }, [cadWorkspace, onCadWorkspaceChange]);
  const setClampedZoom = useCallback((next: number | ((value: number) => number)) => {
    setZoom((value) => Math.min(4, Math.max(0.5, typeof next === 'function' ? next(value) : next)));
  }, []);

  useEffect(() => { setZoom(1); historyRef.current = []; redoRef.current = []; }, [artboard?.id]);
  useEffect(() => { operationSourceRef.current = null; }, [cadWorkspace.activeTool]);
  useEffect(() => { if (!cadWorkspace.osnapEnabled) setSnapPoint(null); }, [cadWorkspace.osnapEnabled]);
  useEffect(() => {
    const close = () => setContextMenu(null);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, select, [contenteditable="true"]')) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); return; }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); return; }
      if ((event.key === 'Delete' || event.key === 'Backspace') && cadWorkspace.selectedEntityIds.length) { event.preventDefault(); commitWorkspace(deleteCadEntities(cadWorkspace, cadWorkspace.selectedEntityIds)); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cadWorkspace, commitWorkspace, redo, undo]);
  useEffect(() => {
    const menu = contextMenu;
    if (!menu) return;
    const frame = sheetRef.current?.closest('.stage__viewport')?.getBoundingClientRect();
    const menuWidth = 210; const menuHeight = 340; const margin = 8;
    const left = Math.min(menu.x, (frame?.right ?? window.innerWidth) - menuWidth - margin);
    const top = Math.min(menu.y, (frame?.bottom ?? window.innerHeight) - menuHeight - margin);
    const boundedX = Math.max((frame?.left ?? 0) + margin, left);
    const boundedY = Math.max((frame?.top ?? 0) + margin, top);
    if (boundedX !== menu.x || boundedY !== menu.y) setContextMenu({ ...menu, x: boundedX, y: boundedY });
  }, [contextMenu]);

  const onWheel = useCallback((event: React.WheelEvent) => {
    event.preventDefault();
    setClampedZoom((value) => value * (event.deltaY < 0 ? 1.1 : 0.9));
  }, [setClampedZoom]);
  const toLocalClient = useCallback((clientX: number, clientY: number): CadPoint => {
    const rect = sheetRef.current?.getBoundingClientRect();
    return rect ? { x: clamp01((clientX - rect.left) / rect.width), y: clamp01((clientY - rect.top) / rect.height) } : { x: 0, y: 0 };
  }, []);
  const toLocal = useCallback((event: React.PointerEvent) => toLocalClient(event.clientX, event.clientY), [toLocalClient]);
  const snap = useCallback((point: CadPoint) => {
    if (!cadWorkspace.osnapEnabled) { setSnapPoint(null); return point; }
    const rect = sheetRef.current?.getBoundingClientRect();
    const tolerance = rect ? cadToleranceForViewport(rect.width, rect.height, 12) : 0.022;
    const result = findCadSnap(point, visibleEntities, cadWorkspace.osnapModes, tolerance);
    setSnapPoint(result);
    return result ?? point;
  }, [cadWorkspace.osnapEnabled, cadWorkspace.osnapModes, visibleEntities]);

  const onDown = useCallback((event: React.PointerEvent) => {
    if (event.button !== 0) return;
    setContextMenu(null);
    const raw = toLocal(event);
    if (maskMode || zoomBoxMode) {
      if (!artboard) return;
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
      setDraft({ x0: raw.x, y0: raw.y, x1: raw.x, y1: raw.y });
      return;
    }
    const point = snap(raw);
    const rect = sheetRef.current?.getBoundingClientRect();
    const hit = findNearestCadEntity(visibleEntities, point, rect ? cadToleranceForViewport(rect.width, rect.height) : 0.022);
    const tool = cadWorkspace.activeTool;
    if (DRAW_TOOLS.includes(tool)) {
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
      setCadDraft({ start: point, end: point });
      return;
    }
    if (tool === 'erase') {
      if (hit) commitWorkspace(deleteCadEntities(cadWorkspace, [hit.id]));
      return;
    }
    if (tool === 'trim' && hit) {
      commitWorkspace(trimCadEntity(cadWorkspace, hit.id, point));
      return;
    }
    if (tool === 'extend' && hit) {
      commitWorkspace(extendCadEntity(cadWorkspace, hit.id, point));
      return;
    }
    if (tool === 'copy' && hit) {
      const ids = editableCadEntityIds(cadWorkspace, expandCadBlockSelection(cadWorkspace, cadWorkspace.selectedEntityIds.includes(hit.id) ? cadWorkspace.selectedEntityIds : [hit.id]));
      const originals = cadWorkspace.entities.filter((entity) => ids.includes(entity.id)).slice(0, Math.max(0, MAX_CAD_ENTITIES - cadWorkspace.entities.length));
      if (!originals.length) return;
      const cloneIds = originals.map(() => createSafeId('cad'));
      const clones = originals.map((entity, index) => translateCadEntity(entity, { x: 0, y: 0 }, cloneIds[index]));
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
      dragEntityRef.current = { mode: 'copy', start: point, originals, cloneIds, before: cadWorkspace };
      onCadWorkspaceChange({ ...cadWorkspace, entities: [...cadWorkspace.entities, ...clones], selectedEntityIds: cloneIds });
      return;
    }
    if (tool === 'array' && hit) {
      const ids = editableCadEntityIds(cadWorkspace, expandCadBlockSelection(cadWorkspace, cadWorkspace.selectedEntityIds.includes(hit.id) ? cadWorkspace.selectedEntityIds : [hit.id]));
      const sources = cadWorkspace.entities.filter((entity) => ids.includes(entity.id));
      // 陣列上限：列×欄（或數量）×選取物件數可能爆量，超過 MAX_CAD_ENTITIES 即停止複製，避免畫布塞進數萬節點而崩潰。
      const room = Math.max(0, MAX_CAD_ENTITIES - cadWorkspace.entities.length);
      const clones: CadEntity[] = [];
      for (const delta of createArrayOffsets(cadWorkspace, { x: 0.055, y: 0.055 })) {
        for (const entity of sources) {
          if (clones.length >= room) break;
          clones.push(translateCadEntity(entity, delta, createSafeId('cad')));
        }
        if (clones.length >= room) break;
      }
      if (clones.length) commitWorkspace({ ...cadWorkspace, entities: [...cadWorkspace.entities, ...clones], selectedEntityIds: clones.map((entity) => entity.id) });
      return;
    }
    if (tool === 'block') {
      // 建立圖塊以目前選取為對象：先選取物件、再點「建立圖塊」；沒有選取時也可直接點在任一物件上。
      const picked = cadWorkspace.selectedEntityIds.length ? cadWorkspace.selectedEntityIds : hit ? [hit.id] : [];
      const members = editableCadEntityIds(cadWorkspace, expandCadBlockSelection(cadWorkspace, picked));
      if (members.length) commitWorkspace(createCadBlock(cadWorkspace, members, createSafeId('block'), `Block ${cadWorkspace.blocks.length + 1}`));
      return;
    }
    if (tool === 'matchprop' && hit) {
      const source = operationSourceRef.current;
      if (!source) {
        operationSourceRef.current = { tool: 'matchprop', entityId: hit.id };
        onCadWorkspaceChange({ ...cadWorkspace, selectedEntityIds: [hit.id] });
        return;
      }
      commitWorkspace(matchCadProperties(cadWorkspace, source.entityId, [hit.id]));
      operationSourceRef.current = null;
      return;
    }
    if (tool === 'align' && hit) {
      const ids = cadWorkspace.selectedEntityIds.includes(hit.id) ? cadWorkspace.selectedEntityIds : [hit.id];
      commitWorkspace(alignCadEntities(cadWorkspace, ids, point));
      return;
    }
    if (tool === 'offset' && hit && isCadEntityEditable(cadWorkspace, hit)) {
      const offset = offsetCadEntity(hit, 0.02, createSafeId('cad'));
      if (offset) commitWorkspace({ ...cadWorkspace, entities: [...cadWorkspace.entities, offset], selectedEntityIds: [offset.id] });
      return;
    }
    if (tool === 'rotate' && hit) {
      const ids = editableCadEntityIds(cadWorkspace, expandCadBlockSelection(cadWorkspace, cadWorkspace.selectedEntityIds.includes(hit.id) ? cadWorkspace.selectedEntityIds : [hit.id]));
      const center = hit.kind === 'circle' ? hit.center : { x: (hit.start.x + hit.end.x) / 2, y: (hit.start.y + hit.end.y) / 2 };
      if (ids.length) commitWorkspace({ ...cadWorkspace, entities: cadWorkspace.entities.map((entity) => ids.includes(entity.id) ? rotateCadEntity(entity, center, Math.PI / 12) : entity), selectedEntityIds: ids });
      return;
    }
    if (tool === 'mirror' && hit) {
      const ids = editableCadEntityIds(cadWorkspace, expandCadBlockSelection(cadWorkspace, cadWorkspace.selectedEntityIds.includes(hit.id) ? cadWorkspace.selectedEntityIds : [hit.id]));
      const clones = cadWorkspace.entities.filter((entity) => ids.includes(entity.id)).map((entity) => mirrorCadEntity(entity, point.x, createSafeId('cad')));
      if (clones.length) commitWorkspace({ ...cadWorkspace, entities: [...cadWorkspace.entities, ...clones], selectedEntityIds: clones.map((entity) => entity.id) });
      return;
    }
    if (tool === 'move' && hit) {
      const ids = editableCadEntityIds(cadWorkspace, expandCadBlockSelection(cadWorkspace, cadWorkspace.selectedEntityIds.includes(hit.id) ? cadWorkspace.selectedEntityIds : [hit.id]));
      if (!ids.length) return;
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
      dragEntityRef.current = { mode: 'move', start: point, originals: cadWorkspace.entities.filter((entity) => ids.includes(entity.id)), before: cadWorkspace };
      onCadWorkspaceChange({ ...cadWorkspace, selectedEntityIds: ids });
      return;
    }
    onCadWorkspaceChange({ ...cadWorkspace, selectedEntityIds: hit ? (event.shiftKey ? Array.from(new Set([...cadWorkspace.selectedEntityIds, hit.id])) : [hit.id]) : [] });
  }, [artboard, cadWorkspace, commitWorkspace, maskMode, onCadWorkspaceChange, snap, toLocal, visibleEntities, zoomBoxMode]);

  const onMove = useCallback((event: React.PointerEvent) => {
    const raw = toLocal(event);
    if (draft) { setDraft((value) => value ? { ...value, x1: raw.x, y1: raw.y } : value); return; }
    const point = snap(raw);
    if (cadDraft) { setCadDraft((value) => value ? { ...value, end: point } : value); return; }
    const moving = dragEntityRef.current;
    if (moving) {
      const delta = { x: point.x - moving.start.x, y: point.y - moving.start.y };
      if (moving.mode === 'copy') {
        const clones = moving.originals.map((entity, index) => translateCadEntity(entity, delta, moving.cloneIds![index]));
        onCadWorkspaceChange({ ...moving.before, entities: [...moving.before.entities, ...clones], selectedEntityIds: moving.cloneIds! });
      } else {
        const originals = new Map(moving.originals.map((entity) => [entity.id, entity]));
        onCadWorkspaceChange({ ...cadWorkspace, entities: cadWorkspace.entities.map((entity) => originals.has(entity.id) ? translateCadEntity(originals.get(entity.id)!, delta) : entity) });
      }
    }
  }, [cadDraft, cadWorkspace, draft, onCadWorkspaceChange, snap, toLocal]);

  const onUp = useCallback((event: React.PointerEvent) => {
    if (draft) {
      (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
      const rect = normalize(draft); setDraft(null);
      if (rect.w < MIN_SIZE || rect.h < MIN_SIZE) return;
      if (zoomBoxMode) { setClampedZoom(Math.min(1 / rect.w, 1 / rect.h)); onZoomBoxModeChange(false); }
      else if (maskMode) onAddMask(rect);
      return;
    }
    if (cadDraft) {
      (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
      const tool = cadWorkspace.activeTool;
      const entities = tool === 'rectangle'
        ? createCadRectangle(cadWorkspace, cadDraft.start, cadDraft.end, Array.from({ length: 4 }, () => createSafeId('cad')))
        : DRAW_TOOLS.includes(tool) ? [createCadEntity(cadWorkspace, tool as 'line' | 'circle' | 'dimension', cadDraft.start, cadDraft.end, createSafeId('cad'))].filter((entity): entity is CadEntity => Boolean(entity)) : [];
      setCadDraft(null);
      if (entities.length) commitWorkspace({ ...cadWorkspace, entities: [...cadWorkspace.entities, ...entities], selectedEntityIds: entities.map((entity) => entity.id) });
      return;
    }
    const moving = dragEntityRef.current;
    if (moving) {
      dragEntityRef.current = null;
      const local = toLocal(event);
      const movedEnough = Math.hypot(local.x - moving.start.x, local.y - moving.start.y) >= 0.002;
      if (!movedEnough) onCadWorkspaceChange(moving.before);
      else {
        historyRef.current = [...historyRef.current.slice(-49), moving.before];
        redoRef.current = [];
      }
    }
  }, [cadDraft, cadWorkspace, commitWorkspace, draft, maskMode, onAddMask, onCadWorkspaceChange, onZoomBoxModeChange, setClampedZoom, toLocal, zoomBoxMode]);

  const onContextMenu = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    const point = toLocalClient(event.clientX, event.clientY);
    const rect = sheetRef.current?.getBoundingClientRect();
    const hit = findNearestCadEntity(visibleEntities, point, rect ? cadToleranceForViewport(rect.width, rect.height) : 0.022);
    if (hit && isCadEntityEditable(cadWorkspace, hit) && !cadWorkspace.selectedEntityIds.includes(hit.id)) onCadWorkspaceChange({ ...cadWorkspace, selectedEntityIds: [hit.id] });
    setContextMenu({ x: event.clientX, y: event.clientY, point, entityId: hit && isCadEntityEditable(cadWorkspace, hit) ? hit.id : undefined });
  }, [cadWorkspace, onCadWorkspaceChange, toLocalClient, visibleEntities]);
  const chooseTool = (tool: CadTool) => { onCadWorkspaceChange({ ...cadWorkspace, activeTool: tool, command: '' }); setContextMenu(null); };
  const contextDelete = () => {
    const ids = contextMenu?.entityId ? (cadWorkspace.selectedEntityIds.includes(contextMenu.entityId) ? cadWorkspace.selectedEntityIds : [contextMenu.entityId]) : cadWorkspace.selectedEntityIds;
    if (ids.length) commitWorkspace(deleteCadEntities(cadWorkspace, ids));
    setContextMenu(null);
  };

  const draftRect = draft ? normalize(draft) : null;
  const cursor = (maskMode || zoomBoxMode || DRAW_TOOLS.includes(cadWorkspace.activeTool)) ? 'crosshair' : cadWorkspace.activeTool === 'move' ? 'move' : 'default';
  return (
    <div className="drawing-viewer">
      <div className="drawing-viewer__zoom" role="group" aria-label="圖面縮放">
        <button type="button" className="iconbtn" aria-label="縮小圖面" onClick={() => setClampedZoom((value) => value / 1.2)}>−</button>
        <button type="button" className="drawing-viewer__zoom-value" aria-label="重設圖面縮放" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
        <button type="button" className="iconbtn" aria-label="放大圖面" onClick={() => setClampedZoom((value) => value * 1.2)}>+</button>
      </div>
      <div ref={sheetRef} className="sheet" style={{ ['--sheet-ratio' as string]: `${ratio}`, ['--sheet-zoom' as string]: `${zoom}`, cursor }} onWheel={onWheel} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={() => { if (!draft && !cadDraft && !dragEntityRef.current) setSnapPoint(null); }} onPointerCancel={() => { setDraft(null); setCadDraft(null); if (dragEntityRef.current) onCadWorkspaceChange(dragEntityRef.current.before); dragEntityRef.current = null; }} onContextMenu={onContextMenu}>
        {artboard ? <img className="sheet__img" src={artboard.imageRef} alt="生成的技術圖面" draggable={false} /> : <div className="sheet__empty"><p className="sheet__empty-title">尚無底圖</p><p className="sheet__empty-desc">可直接使用上方 CAD 工具繪製，或先由 AI 產生圖面。</p></div>}
        {artboard?.textLabels && artboard.textLabels.length > 0 && shouldOverlayLabels(artboard.intent) && (
        /* 草稿文字標示補回：viewBox 用底圖原始像素並以 meet 對齊，與 object-fit: contain 的圖完全重疊。 */
        <svg className={`sheet__labels${artboard.intent.lineStyle === 'blueprint' ? ' sheet__labels--dark' : ''}`} viewBox={`0 0 ${artboard.width} ${artboard.height}`} preserveAspectRatio="xMidYMid meet" aria-label="圖面文字標示" style={{ fontFamily: LABEL_FONT_STACK }}>
          {placeLabels(artboard.textLabels, artboard.width, artboard.height).map((label, index) => (
            <text key={`${index}:${label.text}`} x={label.x} y={label.y} fontSize={label.fontSize} textAnchor={label.anchor} strokeWidth={Math.max(2, label.fontSize * 0.22)} transform={label.rotate ? `rotate(${label.rotate} ${label.x} ${label.y})` : undefined}>{label.text}</text>
          ))}
        </svg>
      )}
      {showGrid && <div className="sheet__grid" />}
        <svg className="cad-overlay" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-label="CAD 物件">
          {visibleEntities.map((entity) => <CadShape key={entity.id} entity={entity} entities={visibleEntities} selected={selected.has(entity.id)} />)}
          {cadWorkspace.blocks.map((block) => {
            const members = cadWorkspace.entities.filter((entity) => block.entityIds.includes(entity.id));
            if (!members.length) return null;
            const anchors = members.map(entityAnchor);
            const cx = anchors.reduce((sum, point) => sum + point.x, 0) / anchors.length * 1000;
            const cy = anchors.reduce((sum, point) => sum + point.y, 0) / anchors.length * 1000;
            return <text key={`block-tag-${block.id}`} className="cad-block-tag" x={cx} y={cy - 16} textAnchor="middle">{block.name}</text>;
          })}
          {cadDraft && (cadWorkspace.activeTool === 'rectangle'
            ? createCadRectangle(cadWorkspace, cadDraft.start, cadDraft.end, ['draft-1', 'draft-2', 'draft-3', 'draft-4']).map((entity) => <CadShape key={entity.id} entity={entity} selected draft />)
            : <CadShape entity={createCadEntity(cadWorkspace, cadWorkspace.activeTool as 'line' | 'circle' | 'dimension', cadDraft.start, cadDraft.end, 'draft') ?? { id: 'draft', kind: 'line', layerId: '', color: '#5EA2FF', start: cadDraft.start, end: cadDraft.end }} selected draft />)}
          {snapPoint && <SnapIndicator snap={snapPoint} />}
        </svg>
        {furniture.length > 0 && (
          /* 圖框（標題欄／比例尺／尺寸列）與匯出共用同一份幾何；drawingText 由呼叫端算好，
             這裡只負責把圖元畫出來，不再自己決定位置。 */
          <svg
            className={`sheet__furniture${artboard?.intent.lineStyle === 'blueprint' ? ' sheet__furniture--dark' : ''}`}
            viewBox={`0 0 1000 ${furnitureHeight}`}
            preserveAspectRatio="none"
            aria-label="圖框與標註"
          >
            {furniture.map((primitive, index) => {
              if (primitive.kind === 'rect') {
                return (
                  <rect
                    key={`furniture-${index}`}
                    x={primitive.x}
                    y={primitive.y}
                    width={primitive.w}
                    height={primitive.h}
                    /* 填的是紙色，不是 currentColor（墨色）；填墨色會把標題欄變成黑色區塊。 */
                    fill={primitive.fill ? 'var(--sheet-paper, #ffffff)' : 'none'}
                    stroke="currentColor"
                    strokeWidth={1.1}
                    vectorEffect="non-scaling-stroke"
                  />
                );
              }
              if (primitive.kind === 'line') {
                return (
                  <line
                    key={`furniture-${index}`}
                    x1={primitive.x1}
                    y1={primitive.y1}
                    x2={primitive.x2}
                    y2={primitive.y2}
                    stroke="currentColor"
                    strokeWidth={1.1}
                    vectorEffect="non-scaling-stroke"
                  />
                );
              }
              return (
                <text
                  key={`furniture-${index}`}
                  x={primitive.x}
                  y={primitive.y}
                  fontSize={primitive.size}
                  textAnchor={primitive.anchor}
                  fontWeight={primitive.weight}
                  fill="currentColor"
                  style={{ fontFamily: LABEL_FONT_STACK }}
                >
                  {primitive.text}
                </text>
              );
            })}
          </svg>
        )}
        {masks.map((mask, index) => <div key={mask.id} className="mask" style={{ left: `${mask.x * 100}%`, top: `${mask.y * 100}%`, width: `${mask.w * 100}%`, height: `${mask.h * 100}%` }}><span className="mask__tag">選區 {index + 1}</span></div>)}
        {draftRect && <div className="mask mask--draft" style={{ left: `${draftRect.x * 100}%`, top: `${draftRect.y * 100}%`, width: `${draftRect.w * 100}%`, height: `${draftRect.h * 100}%` }} />}
      </div>
      {contextMenu && <div className="canvas-context-menu" role="menu" style={{ left: contextMenu.x, top: contextMenu.y }} onPointerDown={(event) => event.stopPropagation()}>
        <button role="menuitem" type="button" onClick={() => chooseTool('select')}>選取 <kbd>Esc</kbd></button>
        <button role="menuitem" type="button" onClick={() => chooseTool('line')}>直線 <kbd>L</kbd></button>
        <button role="menuitem" type="button" onClick={() => chooseTool('circle')}>圓形 <kbd>C</kbd></button>
        <span className="canvas-context-menu__separator" />
        <button role="menuitem" type="button" disabled={!contextMenu.entityId && !cadWorkspace.selectedEntityIds.length} onClick={() => chooseTool('copy')}>複製 <kbd>CO</kbd></button>
        <button role="menuitem" type="button" disabled={!contextMenu.entityId && !cadWorkspace.selectedEntityIds.length} onClick={() => chooseTool('move')}>移動 <kbd>M</kbd></button>
        <button role="menuitem" type="button" disabled={!contextMenu.entityId && !cadWorkspace.selectedEntityIds.length} onClick={contextDelete}>刪除 <kbd>Del</kbd></button>
        <span className="canvas-context-menu__separator" />
        <button role="menuitem" type="button" disabled={!historyRef.current.length} onClick={() => { undo(); setContextMenu(null); }}>復原 <kbd>Ctrl+Z</kbd></button>
        <button role="menuitem" type="button" disabled={!redoRef.current.length} onClick={() => { redo(); setContextMenu(null); }}>重做 <kbd>Ctrl+Y</kbd></button>
        <button role="menuitem" type="button" onClick={() => { setZoom(1); setContextMenu(null); }}>符合視窗 <kbd>100%</kbd></button>
        {artboard && <button role="menuitem" type="button" onClick={() => { onZoomBoxModeChange(true); setContextMenu(null); }}>框選縮放</button>}
      </div>}
    </div>
  );
}

function CadShape({ entity, entities = [], selected, draft = false }: { entity: CadEntity; entities?: readonly CadEntity[]; selected?: boolean; draft?: boolean }) {
  const className = `cad-entity${selected ? ' cad-entity--selected' : ''}${draft ? ' cad-entity--draft' : ''}`;
  if (entity.kind === 'circle') return <circle className={className} cx={entity.center.x * 1000} cy={entity.center.y * 1000} r={entity.radius * 1000} stroke={entity.color} />;
  if (entity.kind === 'dimension') {
    /* 每一種類型的尺寸線、延伸線、箭頭、弧線與文字位置都由 dimensionGeometry 算出來，
       與匯出的 DXF 用同一份幾何，畫面上看到的箭頭方向就是匯出後的箭頭方向。
       手動輸入的數值優先；未輸入時顯示該類型自己的量測值（投影／實長／角度／R／⌀）。 */
    const geometry = dimensionGeometry(entity, entities);
    const p = (point: CadPoint) => `${point.x * 1000} ${point.y * 1000}`;
    return <g className={className} stroke={entity.color} fill={entity.color}>
      {geometry.extensions.map((segment, index) => <line key={`ext-${index}`} className="cad-dim__extension" x1={segment.start.x * 1000} y1={segment.start.y * 1000} x2={segment.end.x * 1000} y2={segment.end.y * 1000} />)}
      {geometry.arc
        ? <path className="cad-dim__line" fill="none" d={`M ${p({ x: geometry.arc.center.x + Math.cos(geometry.arc.from) * geometry.arc.radius, y: geometry.arc.center.y + Math.sin(geometry.arc.from) * geometry.arc.radius })} A ${geometry.arc.radius * 1000} ${geometry.arc.radius * 1000} 0 ${geometry.arc.to - geometry.arc.from > Math.PI ? 1 : 0} 1 ${p({ x: geometry.arc.center.x + Math.cos(geometry.arc.to) * geometry.arc.radius, y: geometry.arc.center.y + Math.sin(geometry.arc.to) * geometry.arc.radius })}`} />
        : <line className="cad-dim__line" x1={geometry.line.start.x * 1000} y1={geometry.line.start.y * 1000} x2={geometry.line.end.x * 1000} y2={geometry.line.end.y * 1000} />}
      {geometry.arrows.flatMap((arrow, index) => arrowLines(arrow).map((segment, side) => <line key={`arrow-${index}-${side}`} className="cad-dim__arrow" strokeWidth={2} x1={segment.start.x * 1000} y1={segment.start.y * 1000} x2={segment.end.x * 1000} y2={segment.end.y * 1000} />))}
      <text className="cad-dim__text" x={geometry.text.x * 1000} y={geometry.text.y * 1000} textAnchor="middle" transform={geometry.text.rotate ? `rotate(${geometry.text.rotate} ${geometry.text.x * 1000} ${geometry.text.y * 1000})` : undefined}>{geometry.text.value}</text>
    </g>;
  }
  return <line className={className} x1={entity.start.x * 1000} y1={entity.start.y * 1000} x2={entity.end.x * 1000} y2={entity.end.y * 1000} stroke={entity.color} />;
}
function SnapIndicator({ snap }: { snap: CadSnapResult }) {
  const x = snap.x * 1000; const y = snap.y * 1000;
  const label = ({ endpoint: '端點', midpoint: '中點', center: '圓心', quadrant: '象限', intersection: '交點' } as const)[snap.mode];
  return <g className={`cad-snap cad-snap--${snap.mode}`} aria-label={`物件鎖點：${label}`}>
    {snap.mode === 'center' ? <circle cx={x} cy={y} r="10" /> : snap.mode === 'midpoint' ? <path d={`M ${x} ${y - 11} L ${x + 11} ${y + 9} L ${x - 11} ${y + 9} Z`} /> : snap.mode === 'intersection' ? <path d={`M ${x - 9} ${y - 9} L ${x + 9} ${y + 9} M ${x + 9} ${y - 9} L ${x - 9} ${y + 9}`} /> : <rect x={x - 9} y={y - 9} width="18" height="18" />}
    <text x={x + 15} y={y - 13}>{label}</text>
  </g>;
}
function normalize(value: Draft) { return { x: Math.min(value.x0, value.x1), y: Math.min(value.y0, value.y1), w: Math.abs(value.x1 - value.x0), h: Math.abs(value.y1 - value.y0) }; }
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
