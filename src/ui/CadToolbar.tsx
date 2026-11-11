import { useEffect, useRef, useState } from 'react';
import {
  addCadLayer, deleteCadLayer, resolveCadCommand, updateCadLayer,
  type ArrayMode, type CadTool, type CadWorkspaceState, type DimensionMode, type OsnapMode,
} from '../core/cad';
import { createSafeId } from '../core/projectSafety';

interface Props { value: CadWorkspaceState; onChange: (next: CadWorkspaceState) => void; }
type ToolGroup = 'draw' | 'modify' | 'annotate' | 'library';

const GROUPS: { id: ToolGroup; label: string; tools: { id: CadTool; label: string; shortcut?: string }[] }[] = [
  { id: 'draw', label: '繪圖', tools: [
    { id: 'select', label: '選取', shortcut: 'Esc' }, { id: 'line', label: '直線', shortcut: 'L' },
    { id: 'rectangle', label: '矩形', shortcut: 'REC' }, { id: 'circle', label: '圓形', shortcut: 'C' },
  ] },
  { id: 'modify', label: '修改', tools: [
    { id: 'erase', label: '刪除', shortcut: 'E' }, { id: 'copy', label: '複製', shortcut: 'CO' },
    { id: 'move', label: '移動', shortcut: 'M' }, { id: 'trim', label: '修剪', shortcut: 'TR' },
    { id: 'extend', label: '延伸', shortcut: 'EX' }, { id: 'offset', label: '偏移', shortcut: 'O' },
    { id: 'rotate', label: '旋轉 15°', shortcut: 'RO' }, { id: 'mirror', label: '鏡射', shortcut: 'MI' },
    { id: 'align', label: '對齊', shortcut: 'AL' }, { id: 'matchprop', label: '性質複製', shortcut: 'MA' },
  ] },
  { id: 'annotate', label: '標註', tools: [{ id: 'dimension', label: '尺寸', shortcut: 'DIM' }] },
  { id: 'library', label: '元件', tools: [{ id: 'block', label: '建立圖塊', shortcut: 'B' }, { id: 'array', label: '陣列', shortcut: 'AR' }] },
];
const DIMENSION_MODES: { value: DimensionMode; label: string }[] = [{ value: 'linear', label: '線性' }, { value: 'aligned', label: '對齊' }, { value: 'angular', label: '角度' }, { value: 'continue', label: '連續' }];
const ARRAY_MODES: { value: ArrayMode; label: string }[] = [{ value: 'rectangular', label: '矩形' }, { value: 'polar', label: '環形' }, { value: 'path', label: '路徑' }];
const OSNAP_MODES: { value: OsnapMode; label: string }[] = [{ value: 'endpoint', label: '端點' }, { value: 'midpoint', label: '中點' }, { value: 'center', label: '圓心' }, { value: 'quadrant', label: '象限點' }, { value: 'intersection', label: '交點' }];

export function CadToolbar({ value, onChange }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [openGroup, setOpenGroup] = useState<ToolGroup | null>(null);
  const [showLayer, setShowLayer] = useState(false);
  const [showSnap, setShowSnap] = useState(false);
  const activeLayer = value.layers.find((layer) => layer.id === value.activeLayerId);
  const activeTool = GROUPS.flatMap((group) => group.tools).find((tool) => tool.id === value.activeTool);
  const choose = (tool: CadTool) => { onChange({ ...value, activeTool: tool, command: '' }); setOpenGroup(null); };
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) { setOpenGroup(null); setShowLayer(false); setShowSnap(false); }
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, []);
  const updateLayer = (id: string, delta: Parameters<typeof updateCadLayer>[2]) => onChange(updateCadLayer(value, id, delta));
  const addLayer = () => onChange(addCadLayer(value, { id: createSafeId('layer'), name: `Layer ${value.layers.length + 1}`, color: '#64748B', visible: true, locked: false }));

  return <div ref={rootRef} className="cad-ribbon" aria-label="CAD 工具列">
    <div className="cad-ribbon__primary" role="toolbar" aria-label="CAD 分類工具">
      <div className="cad-ribbon__groups">
        {GROUPS.map((group) => <div className="cad-ribbon__group" key={group.id}>
          <button type="button" className="cad-ribbon__group-button" aria-expanded={openGroup === group.id} onClick={() => setOpenGroup(openGroup === group.id ? null : group.id)}>
            <span>{group.label}</span><span className="cad-ribbon__group-count">{group.tools.length}</span>
          </button>
          {openGroup === group.id && <div className="cad-ribbon__menu" role="menu" aria-label={`${group.label}工具`}>
            {group.tools.map((tool) => <button type="button" role="menuitem" key={tool.id} className="cad-ribbon__menu-item" aria-current={value.activeTool === tool.id} onClick={() => choose(tool.id)}>
              <span>{tool.label}</span><kbd>{tool.shortcut}</kbd>
            </button>)}
          </div>}
        </div>)}
      </div>
      <div className="cad-ribbon__active" aria-live="polite"><span>目前工具</span><strong>{activeTool?.label ?? '選取'}</strong></div>
      <div className="cad-ribbon__spacer" />
      <label className="cad-ribbon__command"><span>指令</span><input value={value.command} aria-label="CAD 指令輸入" placeholder="L、REC、O、RO…" spellCheck={false} onChange={(event) => onChange({ ...value, command: event.target.value })} onKeyDown={(event) => { if (event.key === 'Escape') { choose('select'); return; } if (event.key !== 'Enter') return; const next = resolveCadCommand(event.currentTarget.value); if (next) choose(next); }} /></label>
    </div>
    <div className="cad-ribbon__secondary">
      <div className="cad-ribbon__control">
        <button type="button" className="cad-ribbon__toggle" aria-pressed={value.osnapEnabled} onClick={() => onChange({ ...value, osnapEnabled: !value.osnapEnabled })}>物件鎖點</button>
        <button type="button" className="cad-ribbon__disclosure" aria-expanded={showSnap} aria-label="設定物件鎖點" onClick={() => setShowSnap(!showSnap)}>⌄</button>
        {showSnap && <div className="cad-ribbon__popover">{OSNAP_MODES.map((mode) => <label key={mode.value} className="cad-ribbon__check"><input type="checkbox" checked={value.osnapModes.includes(mode.value)} onChange={(event) => onChange({ ...value, osnapModes: event.target.checked ? [...value.osnapModes, mode.value] : value.osnapModes.filter((item) => item !== mode.value) })} />{mode.label}</label>)}</div>}
      </div>
      <div className="cad-ribbon__control">
        <button type="button" className="cad-ribbon__toggle" aria-expanded={showLayer} onClick={() => setShowLayer(!showLayer)}>圖層：{activeLayer?.name ?? '—'}</button>
        {showLayer && <div className="cad-ribbon__popover cad-ribbon__popover--layer">
          <div className="cad-ribbon__layer-head"><strong>圖層管理</strong><button type="button" onClick={addLayer}>＋ 新增</button></div>
          {value.layers.map((layer) => <div className="cad-ribbon__layer" key={layer.id}>
            <button type="button" className="cad-ribbon__layer-name" aria-current={layer.id === value.activeLayerId} disabled={!layer.visible || layer.locked} title={!layer.visible ? '請先顯示此圖層' : layer.locked ? '請先解除鎖定' : '設為目前圖層'} onClick={() => onChange({ ...value, activeLayerId: layer.id })}>{layer.name}</button>
            <input type="color" aria-label={`${layer.name} 顏色`} value={layer.color} onChange={(event) => updateLayer(layer.id, { color: event.target.value })} />
            <button type="button" aria-pressed={layer.visible} title={layer.visible ? '隱藏圖層' : '顯示圖層'} onClick={() => updateLayer(layer.id, { visible: !layer.visible })}>{layer.visible ? '◉' : '○'}</button>
            <button type="button" aria-pressed={layer.locked} title={layer.locked ? '解除鎖定' : '鎖定圖層'} onClick={() => updateLayer(layer.id, { locked: !layer.locked })}>{layer.locked ? '鎖' : '開'}</button>
            <button type="button" disabled={value.layers.length <= 1 || layer.locked} title="刪除圖層並移轉物件" onClick={() => onChange(deleteCadLayer(value, layer.id))}>刪</button>
          </div>)}
          <p className="cad-ribbon__hint">可在下方直接重新命名圖層</p>
          {value.layers.map((layer) => <input key={`rename-${layer.id}`} className="cad-ribbon__layer-rename" aria-label={`重新命名 ${layer.name}`} value={layer.name} onChange={(event) => updateLayer(layer.id, { name: event.target.value })} />)}
        </div>}
      </div>
      {value.activeTool === 'dimension' && <><label className="cad-ribbon__select">尺寸類型<select value={value.dimensionMode} onChange={(event) => onChange({ ...value, dimensionMode: event.target.value as DimensionMode })}>{DIMENSION_MODES.map((mode) => <option key={mode.value} value={mode.value}>{mode.label}</option>)}</select></label><label className="cad-ribbon__number">尺寸數值<input type="text" className="cad-ribbon__dimension-value" value={value.dimensionText} placeholder="自動量測" onChange={(event) => {
        const dimensionText = event.target.value.slice(0, 40);
        // 數值同時套用到新畫的尺寸與當前選取的尺寸標註；清空即恢復自動量測。
        const picked = new Set(value.selectedEntityIds);
        const entities = value.selectedEntityIds.length
          ? value.entities.map((entity) => entity.kind === 'dimension' && picked.has(entity.id) ? { ...entity, text: dimensionText.trim() ? dimensionText : undefined } : entity)
          : value.entities;
        onChange({ ...value, dimensionText, entities });
      }} /></label></>}
      {value.activeTool === 'array' && <>
        <label className="cad-ribbon__select">陣列<select value={value.arrayMode} onChange={(event) => onChange({ ...value, arrayMode: event.target.value as ArrayMode })}>{ARRAY_MODES.map((mode) => <option key={mode.value} value={mode.value}>{mode.label}</option>)}</select></label>
        {value.arrayMode === 'rectangular' ? <><NumberControl label="列" value={value.arrayRows} min={1} max={20} onChange={(arrayRows) => onChange({ ...value, arrayRows })} /><NumberControl label="欄" value={value.arrayColumns} min={1} max={20} onChange={(arrayColumns) => onChange({ ...value, arrayColumns })} /></> : <NumberControl label="數量" value={value.arrayCount} min={2} max={36} onChange={(arrayCount) => onChange({ ...value, arrayCount })} />}
      </>}
      <span className="cad-ribbon__status">物件 {value.entities.length} · 已選 {value.selectedEntityIds.length} · 圖塊 {value.blocks.length}</span>
    </div>
  </div>;
}

function NumberControl({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return <label className="cad-ribbon__number">{label}<input type="number" value={value} min={min} max={max} onChange={(event) => onChange(Math.max(min, Math.min(max, Number(event.target.value) || min)))} /></label>;
}
