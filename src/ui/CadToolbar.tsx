import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  addCadLayer, deleteCadLayer, resolveCadCommand, updateCadLayer,
  type ArrayMode, type CadDimensionEntity, type CadTool, type CadWorkspaceState, type DimensionMode, type OsnapMode,
} from '../core/cad';
import { createSafeId } from '../core/projectSafety';
import { DIMENSION_MODE_LIST } from '../core/dimension';

interface Props { value: CadWorkspaceState; onChange: (next: CadWorkspaceState) => void; }

/* ── AutoCAD 式功能區：每個「面板」是一條直欄，面板由上而下是
   小圖示按鈕（或大圖示）＋面板標題，面板之間用 1px 直線分隔。
   這樣 30 多個指令才能在單列高度內全部看得到，不必先開下拉選單。 */
type PanelId = 'draw' | 'modify' | 'annotate' | 'control';

interface ToolDef { id: CadTool; label: string; shortcut?: string; icon: ToolIconName; large?: boolean }

const DRAW_TOOLS: ToolDef[] = [
  { id: 'select', label: '選取', shortcut: 'Esc', icon: 'cursor' },
  { id: 'line', label: '直線', shortcut: 'L', icon: 'line' },
  { id: 'rectangle', label: '矩形', shortcut: 'REC', icon: 'rect' },
  { id: 'circle', label: '圓形', shortcut: 'C', icon: 'circle' },
];
const MODIFY_TOOLS: ToolDef[] = [
  { id: 'erase', label: '刪除', shortcut: 'E', icon: 'erase' },
  { id: 'copy', label: '複製', shortcut: 'CO', icon: 'copy' },
  { id: 'move', label: '移動', shortcut: 'M', icon: 'move' },
  { id: 'trim', label: '修剪', shortcut: 'TR', icon: 'trim' },
  { id: 'extend', label: '延伸', shortcut: 'EX', icon: 'extend' },
  { id: 'offset', label: '偏移', shortcut: 'O', icon: 'offset' },
  { id: 'rotate', label: '旋轉 15°', shortcut: 'RO', icon: 'rotate' },
  { id: 'mirror', label: '鏡射', shortcut: 'MI', icon: 'mirror' },
  { id: 'align', label: '對齊', shortcut: 'AL', icon: 'align' },
  { id: 'matchprop', label: '性質複製', shortcut: 'MA', icon: 'matchprop' },
];
const ANNOTATE_TOOLS: ToolDef[] = [
  { id: 'dimension', label: '尺寸', shortcut: 'DIM', icon: 'dimension', large: true },
];
const LIBRARY_TOOLS: ToolDef[] = [
  { id: 'block', label: '建立圖塊', shortcut: 'B', icon: 'block' },
  { id: 'array', label: '陣列', shortcut: 'AR', icon: 'array' },
];

const ALL_TOOLS = [...DRAW_TOOLS, ...MODIFY_TOOLS, ...ANNOTATE_TOOLS, ...LIBRARY_TOOLS];

const ARRAY_MODES: { value: ArrayMode; label: string }[] = [{ value: 'rectangular', label: '矩形' }, { value: 'polar', label: '環形' }, { value: 'path', label: '路徑' }];
const OSNAP_MODES: { value: OsnapMode; label: string }[] = [{ value: 'endpoint', label: '端點' }, { value: 'midpoint', label: '中點' }, { value: 'center', label: '圓心' }, { value: 'quadrant', label: '象限點' }, { value: 'intersection', label: '交點' }];

export function CadToolbar({ value, onChange }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [showLayer, setShowLayer] = useState(false);
  const [showSnap, setShowSnap] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const activeLayer = value.layers.find((layer) => layer.id === value.activeLayerId);
  const activeTool = ALL_TOOLS.find((tool) => tool.id === value.activeTool);
  /* 選到的尺寸標註要用它自己存的數值與類型顯示。
     少了這段，使用者填過數值、再點回那條尺寸時輸入框會變回空白（看起來像「填了沒生效」），
     類型選單也還是上一次的選擇（看起來像「選哪個都一樣」）。 */
  const pickedDimension = value.entities.find(
    (entity): entity is CadDimensionEntity => entity.kind === 'dimension' && value.selectedEntityIds.includes(entity.id),
  );
  const dimensionTextShown = pickedDimension?.text || value.dimensionText || '';
  const dimensionModeShown = pickedDimension?.mode ?? value.dimensionMode;
  const choose = (tool: CadTool) => { onChange({ ...value, activeTool: tool, command: '' }); };
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) { setShowLayer(false); setShowSnap(false); }
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, []);
  const updateLayer = (id: string, delta: Parameters<typeof updateCadLayer>[2]) => onChange(updateCadLayer(value, id, delta));
  const addLayer = () => onChange(addCadLayer(value, { id: createSafeId('layer'), name: `Layer ${value.layers.length + 1}`, color: '#64748B', visible: true, locked: false }));

  const toolButton = (tool: ToolDef) => (
    <button
      key={tool.id}
      type="button"
      className={`cad-ribbon__tool${tool.large ? ' cad-ribbon__tool--large' : ''}`}
      aria-pressed={value.activeTool === tool.id}
      title={tool.shortcut ? `${tool.label}（${tool.shortcut}）` : tool.label}
      onClick={() => choose(tool.id)}
    >
      <ToolIcon name={tool.icon} />
      <span>{tool.label}</span>
    </button>
  );

  return <div ref={rootRef} className={`cad-ribbon${collapsed ? ' cad-ribbon--collapsed' : ''}`} aria-label="CAD 工具列">
    {/* 標題列：面板群組頁籤 + 目前指令 + 指令輸入（對應 AutoCAD 的 Quick Access 與 Command Line）。 */}
    <div className="cad-ribbon__tabbar">
      <div className="cad-ribbon__tabs" role="tablist" aria-label="工具頁籤">
        <span className="cad-ribbon__tab" role="tab" aria-selected="true">常用</span>
        {(['draw', 'modify', 'annotate', 'control'] as PanelId[]).map((id) => (
          <span className="cad-ribbon__tab cad-ribbon__tab--muted" key={id} role="tab" aria-selected="false">{PANEL_TITLES[id]}</span>
        ))}
      </div>
      <div className="cad-ribbon__active" aria-live="polite">
        <span>目前工具</span>
        <strong>{activeTool?.label ?? '選取'}</strong>
        {activeTool?.shortcut && <kbd>{activeTool.shortcut}</kbd>}
      </div>
      <button
        type="button"
        className="cad-ribbon__collapse"
        aria-expanded={!collapsed}
        title={collapsed ? '展開工具面板' : '收合工具面板'}
        onClick={() => setCollapsed(!collapsed)}
      >
        <ToolIcon name={collapsed ? 'chevronDown' : 'chevronUp'} />
      </button>
      <label className="cad-ribbon__command">
        <span>指令</span>
        <input
          value={value.command}
          aria-label="CAD 指令輸入"
          placeholder="L、REC、O、RO…"
          spellCheck={false}
          onChange={(event) => onChange({ ...value, command: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === 'Escape') { choose('select'); return; }
            if (event.key !== 'Enter') return;
            const next = resolveCadCommand(event.currentTarget.value);
            if (next) choose(next);
          }}
        />
      </label>
    </div>

    {!collapsed && (
      <div className="cad-ribbon__panels">
        <Panel title="繪圖">
          <div className="cad-ribbon__toolgrid">{DRAW_TOOLS.map(toolButton)}</div>
        </Panel>
        <Panel title="修改">
          <div className="cad-ribbon__toolgrid">{MODIFY_TOOLS.map(toolButton)}</div>
        </Panel>
        <Panel title="標註">
          <div className="cad-ribbon__toolgrid">{ANNOTATE_TOOLS.map(toolButton)}</div>
          <div className="cad-ribbon__toolgrid cad-ribbon__toolgrid--pair">{LIBRARY_TOOLS.map(toolButton)}</div>
        </Panel>
        <Panel title="圖層">
          <div className="cad-ribbon__toolgrid cad-ribbon__toolgrid--pair">
            <div className="cad-ribbon__control">
              <button type="button" className="cad-ribbon__toggle" aria-expanded={showLayer} title={`圖層：${activeLayer?.name ?? '—'}`} onClick={() => setShowLayer(!showLayer)}>
                <ToolIcon name="layers" />
                <span className="cad-ribbon__truncate">{activeLayer?.name ?? '—'}</span>
              </button>
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
          </div>
          <div className="cad-ribbon__toolgrid cad-ribbon__toolgrid--pair">
            <div className="cad-ribbon__control">
              <button type="button" className="cad-ribbon__toggle" aria-pressed={value.osnapEnabled} title="物件鎖點開關" onClick={() => onChange({ ...value, osnapEnabled: !value.osnapEnabled })}>
                <ToolIcon name="osnap" />
                <span>鎖點</span>
              </button>
              <button type="button" className="cad-ribbon__disclosure" aria-expanded={showSnap} aria-label="設定物件鎖點" title="鎖點模式" onClick={() => setShowSnap(!showSnap)}>⌄</button>
              {showSnap && <div className="cad-ribbon__popover">{OSNAP_MODES.map((mode) => <label key={mode.value} className="cad-ribbon__check"><input type="checkbox" checked={value.osnapModes.includes(mode.value)} onChange={(event) => onChange({ ...value, osnapModes: event.target.checked ? [...value.osnapModes, mode.value] : value.osnapModes.filter((item) => item !== mode.value) })} />{mode.label}</label>)}</div>}
            </div>
          </div>
        </Panel>
        <Panel title="狀態" grow>
          <span className="cad-ribbon__status">物件 {value.entities.length} · 已選 {value.selectedEntityIds.length} · 圖塊 {value.blocks.length}</span>
        </Panel>
      </div>
    )}

    {/* 性質列：只有在需要參數的指令被選取時才出現，對應 AutoCAD 的功能區上下文面板。 */}
    {(value.activeTool === 'dimension' || value.activeTool === 'array') && (
      <div className="cad-ribbon__context">
        {value.activeTool === 'dimension' && <>
          <span className="cad-ribbon__context-label">尺寸</span>
          {/* 類型選單旁直接顯示該類型的量法，選單不再只是換一個字。 */}
          <label className="cad-ribbon__select" title={DIMENSION_MODE_LIST.find((mode) => mode.value === dimensionModeShown)?.hint}>
            尺寸類型
            <select value={dimensionModeShown} onChange={(event) => {
              const dimensionMode = event.target.value as DimensionMode;
              // 換類型要真的換：連目前選取的尺寸一起改寫，否則選單換了字、圖上那條尺寸不會跟著變。
              const picked = new Set(value.selectedEntityIds);
              const entities = value.selectedEntityIds.length
                ? value.entities.map((entity) => entity.kind === 'dimension' && picked.has(entity.id) ? { ...entity, mode: dimensionMode } : entity)
                : value.entities;
              onChange({ ...value, dimensionMode, entities });
            }}>{DIMENSION_MODE_LIST.map((mode) => <option key={mode.value} value={mode.value} title={mode.hint}>{mode.label}</option>)}</select>
          </label>
          <span className="cad-ribbon__dimension-hint">{DIMENSION_MODE_LIST.find((mode) => mode.value === dimensionModeShown)?.hint}</span>
          {/* 數值輸入：填了就以填的值顯示（可寫 R12、⌀20、45° 等字串），清空即恢復自動量測。 */}
          <label className="cad-ribbon__number cad-ribbon__number--dim">
            尺寸數值
            <input type="text" inputMode="decimal" className="cad-ribbon__dimension-value" value={dimensionTextShown} placeholder="自動量測" title="輸入後套用到新畫的尺寸與目前選取的尺寸；清空恢復自動量測。" onChange={(event) => {
              const dimensionText = event.target.value.slice(0, 40);
              // 數值同時套用到新畫的尺寸與當前選取的尺寸標註；清空即恢復自動量測。
              const picked = new Set(value.selectedEntityIds);
              const entities = value.selectedEntityIds.length
                ? value.entities.map((entity) => entity.kind === 'dimension' && picked.has(entity.id) ? { ...entity, text: dimensionText.trim() ? dimensionText : undefined } : entity)
                : value.entities;
              onChange({ ...value, dimensionText, entities });
            }} />
          </label>
          {dimensionTextShown.trim() && <button type="button" className="cad-ribbon__clear" title="清空數值，改回自動量測" onClick={() => {
            // 清除同時清掉輸入值與選取尺寸上手動輸入的值，畫面與圖面才一致。
            const picked = new Set(value.selectedEntityIds);
            const entities = value.selectedEntityIds.length
              ? value.entities.map((entity) => entity.kind === 'dimension' && picked.has(entity.id) ? { ...entity, text: undefined } : entity)
              : value.entities;
            onChange({ ...value, dimensionText: '', entities });
          }}>清除</button>}
        </>}
        {value.activeTool === 'array' && <>
          <span className="cad-ribbon__context-label">陣列</span>
          <label className="cad-ribbon__select">排列<select value={value.arrayMode} onChange={(event) => onChange({ ...value, arrayMode: event.target.value as ArrayMode })}>{ARRAY_MODES.map((mode) => <option key={mode.value} value={mode.value}>{mode.label}</option>)}</select></label>
          {value.arrayMode === 'rectangular'
            ? <><NumberControl label="列" value={value.arrayRows} min={1} max={20} onChange={(arrayRows) => onChange({ ...value, arrayRows })} /><NumberControl label="欄" value={value.arrayColumns} min={1} max={20} onChange={(arrayColumns) => onChange({ ...value, arrayColumns })} /></>
            : <NumberControl label="數量" value={value.arrayCount} min={2} max={36} onChange={(arrayCount) => onChange({ ...value, arrayCount })} />}
        </>}
      </div>
    )}
  </div>;
}

const PANEL_TITLES: Record<PanelId, string> = { draw: '繪圖', modify: '修改', annotate: '標註', control: '圖層' };

function Panel({ title, grow, children }: { title: string; grow?: boolean; children: ReactNode }) {
  return <div className={`cad-ribbon__panel${grow ? ' cad-ribbon__panel--grow' : ''}`}>
    <div className="cad-ribbon__panel-body">{children}</div>
    <div className="cad-ribbon__panel-title">{title}</div>
  </div>;
}

function NumberControl({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return <label className="cad-ribbon__number">{label}<input type="number" value={value} min={min} max={max} onChange={(event) => onChange(Math.max(min, Math.min(max, Number(event.target.value) || min)))} /></label>;
}

/* ── 圖示：全部手寫 24×24 線稿，stroke 用 currentColor，
   所以深／淺色主題與選取狀態都只要改 color 就好。 */
type ToolIconName =
  | 'cursor' | 'line' | 'rect' | 'circle' | 'erase' | 'copy' | 'move' | 'trim'
  | 'extend' | 'offset' | 'rotate' | 'mirror' | 'align' | 'matchprop'
  | 'dimension' | 'block' | 'array' | 'layers' | 'osnap' | 'chevronUp' | 'chevronDown';

const ICON_PATHS: Record<ToolIconName, ReactNode> = {
  cursor: <path d="M6 3.5 18 12l-5.2 1.3L10.5 19z" />,
  line: <><path d="M5 19 19 5" /><circle cx="5" cy="19" r="1.8" /><circle cx="19" cy="5" r="1.8" /></>,
  rect: <><rect x="3.5" y="6" width="17" height="12" rx="1" /><circle cx="3.5" cy="6" r="1.6" /><circle cx="20.5" cy="18" r="1.6" /></>,
  circle: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="1.4" /></>,
  erase: <><path d="M8 20h11" /><path d="M4.5 15.5 12 8l6 6-5 5H9z" /></>,
  copy: <><rect x="8.5" y="8.5" width="11" height="11" rx="1.5" /><path d="M15.5 5.5h-10a1 1 0 0 0-1 1v10" /></>,
  move: <><path d="M12 3.5v17M3.5 12h17" /><path d="M9 6.5 12 3.5l3 3M9 17.5l3 3 3-3M6.5 9 3.5 12l3 3M17.5 9l3 3-3 3" /></>,
  trim: <><path d="M3.5 19 12 8M20.5 19 12 8" /><circle cx="12" cy="6" r="3.2" /></>,
  extend: <><path d="M3.5 6v12" /><path d="M7 12h10" /><path d="M14 8.5 17.5 12 14 15.5" /><path d="M20.5 6v12" /></>,
  offset: <><rect x="3.5" y="3.5" width="10" height="10" rx="1" /><rect x="8.5" y="8.5" width="12" height="12" rx="1" strokeDasharray="3 2.4" /></>,
  rotate: <><path d="M20 12a8 8 0 1 1-3.4-6.5" /><path d="M20.5 4.5v4h-4" /></>,
  mirror: <><path d="M12 3v18" strokeDasharray="3 2.6" /><path d="M9 7 4 12l5 5z" /><path d="M15 7l5 5-5 5z" /></>,
  align: <><path d="M3.5 5.5v13" /><path d="M8 9h11M8 15h11" /><path d="M5.5 12H8" /></>,
  matchprop: <><path d="M4 8.5h9l3.5 3.5" /><path d="M4 15.5h9" /><rect x="16" y="9" width="4.5" height="6" rx="1" /></>,
  dimension: <><path d="M4 8v8M20 8v8" /><path d="M4 12h16" /><path d="M7.5 9.5 4 12l3.5 2.5M16.5 9.5 20 12l-3.5 2.5" /></>,
  block: <><rect x="4" y="4" width="11" height="11" rx="1" /><path d="M9.5 9.5 20 15l-4 1.5L14.5 21z" /></>,
  array: <><rect x="3.5" y="3.5" width="6" height="6" rx="1" /><rect x="14.5" y="3.5" width="6" height="6" rx="1" /><rect x="3.5" y="14.5" width="6" height="6" rx="1" /><rect x="14.5" y="14.5" width="6" height="6" rx="1" /></>,
  layers: <><path d="M12 3.5 21 8l-9 4.5L3 8z" /><path d="M5.5 12.5 3 14l9 4.5 9-4.5-2.5-1.5" /></>,
  osnap: <><path d="M4 4v9M20 20v-9" /><path d="M4 13h16" /><circle cx="12" cy="13" r="2.6" /></>,
  chevronUp: <path d="M5.5 15 12 8.5 18.5 15" />,
  chevronDown: <path d="M5.5 9 12 15.5 18.5 9" />,
};

function ToolIcon({ name }: { name: ToolIconName }) {
  return <svg className="cad-ribbon__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">{ICON_PATHS[name]}</svg>;
}
