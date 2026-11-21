import { useEffect, useRef, useState } from 'react';
import type { Settings } from '../core/settings';
import type { ReferenceAttachment } from '../core/types';
import { createDefaultIntent } from '../core/types';
import { listProjects, loadProject, saveProject, deleteProject, type ProjectDocument, type ProjectMeta } from '../core/projects';
import { emptyEngineeringDocument, validateEngineeringDocument, type EngineeringDocument, type GeometryFeature, type VectorEntity } from '../core/geometry/document';
import { GeometryClient } from '../core/geometry/client';
import type { GeometryResult } from '../core/geometry/kernel';
import { generateEngineeringDocument, refineEngineeringPrompt } from '../core/geometry/ai';
import { geometryProvider } from '../core/geometry/models';
import { exportVectorDxf, exportVectorSvg, vectorNumbers } from '../core/geometry/vector';
import { exportDrawingSheet } from '../core/geometry/sheet';
import { arrayVectors, moveVector } from '../core/geometry/edit';
import { Button, Field, Segmented } from './primitives';
import { ReferencePanel } from './ReferencePanel';
import { SettingsSheet } from './SettingsSheet';
import type { CategoryId } from './SettingsSheet';
import { EngineeringSettings } from './EngineeringSettings';
import { GeometryModels } from './GeometryModels';
import { GeometryViewport } from './GeometryViewport';
import { VectorViewport } from './VectorViewport';
import './engineering.css';
function download(blob: Blob, name: string) { const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
export function EngineeringWorkspace({ settings, onSettings, onLegacy, settingsCategory, onSettingsCategory }: { settings: Settings; onSettings: (s: Settings) => void; onLegacy: (id?: string) => void; settingsCategory: CategoryId | null; onSettingsCategory: (category: CategoryId | null) => void }) {
  const [doc, setDoc] = useState(() => emptyEngineeringDocument('3d'));
  const [undo, setUndo] = useState<EngineeringDocument[]>([]); const [redo, setRedo] = useState<EngineeringDocument[]>([]);
  const [prompt, setPrompt] = useState(''); const [command, setCommand] = useState('');
  const [refs, setRefs] = useState<ReferenceAttachment[]>([]); const [selected, setSelected] = useState<string[]>([]);
  const [result, setResult] = useState<GeometryResult | null>(null); const [status, setStatus] = useState('輸入需求，或先新增幾何特徵');
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [settingsOpen, setSettingsOpen] = useState(false);
  useEffect(() => { if (settingsCategory) setSettingsOpen(true); }, [settingsCategory]);
  const [projects, setProjects] = useState<ProjectMeta[] | null>(null); const [view, setView] = useState('iso');
  const [dirty, setDirty] = useState(false); const [savedProject, setSavedProject] = useState<ProjectDocument | null>(null);
  const [offset, setOffset] = useState({ x: 10, y: 0, count: 2 });
  const client = useRef(new GeometryClient()); const controller = useRef<AbortController | null>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const mutationLock = useRef(false);
  useEffect(() => () => { controller.current?.abort(); client.current.dispose(); }, []);
  useEffect(() => {
    let live = true;
    if (doc.mode === '3d' && doc.features.length) {
      setResult(null);
      void client.current.request(doc).then(data => { if (live) setResult(data as GeometryResult); }).catch(e => { if (live) { setResult(null); setError(e.message); } });
    } else setResult(null);
    return () => { live = false; };
  }, [doc]);
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => { if (dirty || busy) { e.preventDefault(); e.returnValue = ''; } };
    const requestClose = () => {
      if (busy || mutationLock.current) { setStatus('請等待目前操作完成，或先取消生成'); return; }
      if (!dirty || window.confirm('尚有未儲存的修改，確定關閉 AiCAD？')) void window.__AICAD_HOST_CLOSE_NOW__?.();
    };
    window.__AICAD_REQUEST_CLOSE__ = requestClose;
    window.addEventListener('beforeunload', handler);
    return () => { if (window.__AICAD_REQUEST_CLOSE__ === requestClose) delete window.__AICAD_REQUEST_CLOSE__; window.removeEventListener('beforeunload', handler); };
  }, [dirty, busy]);
  async function commit(next: EngineeringDocument, signal?: AbortSignal) {
    if (mutationLock.current) return;
    mutationLock.current = true; setBusy(true);
    setError('');
    try {
      next = validateEngineeringDocument(next);
      if (next.mode === '3d' && next.features.length) await client.current.request(next, undefined, signal);
      if (next.mode === '2d') for (const entity of next.entities) vectorNumbers(entity, next);
      signal?.throwIfAborted();
      setUndo(old => [...old.slice(-38), doc]); setRedo([]); setDoc(next); setSelected(old => old.filter(id => [...next.features, ...next.entities].some(item => item.id === id))); setDirty(true); setStatus('幾何已更新');
    } catch (e) { if (signal?.aborted) { setStatus('已取消'); throw e; } setError(e instanceof Error ? e.message : '無法更新幾何'); }
    finally { mutationLock.current = false; setBusy(false); }
  }
  function select(id: string, additive: boolean) { setSelected(old => !id ? [] : additive ? old.includes(id) ? old.filter(v => v !== id) : [...old, id] : [id]); }
  async function generate(local = false, refine = false) {
    if (busy) return;
    const request = refine ? prompt : command || prompt;
    if (!request.trim()) return;
    const abort = new AbortController(); controller.current = abort; setBusy(true); setError('');
    try {
      if (refine) { setStatus('正在精煉提示詞'); const refined = await refineEngineeringPrompt(settings, request, doc, refs, abort.signal); abort.signal.throwIfAborted(); setPrompt(refined); setStatus('提示詞已精煉'); }
      else {
        const next = await generateEngineeringDocument({ settings, prompt: request, current: doc, references: refs, selected: local ? selected : undefined, client: client.current, signal: abort.signal, onStatus: setStatus });
        abort.signal.throwIfAborted(); await commit(next, abort.signal); setCommand('');
      }
    } catch (e) { if (!abort.signal.aborted) setError(e instanceof Error ? e.message : '生成失敗'); else setStatus('已取消'); }
    finally { setBusy(false); controller.current = null; }
  }
  async function save() {
    if (busy || mutationLock.current) return;
    mutationLock.current = true; setBusy(true);
    try {
      const project: ProjectDocument = { ...(savedProject ?? { schemaVersion: 1, intent: createDefaultIntent(), history: [], currentId: null, masks: [], showGrid: true }), id: doc.id, name: doc.name, updatedAt: Date.now(), engineering: doc, engineeringHistory: undo };
      await saveProject(project); setSavedProject(project); setDirty(false); setStatus('專案已儲存');
    } catch { setError('無法儲存專案，請檢查可用空間'); }
    finally { mutationLock.current = false; setBusy(false); }
  }
  const confirmDiscard = () => !busy && (!dirty || window.confirm('尚有未儲存的修改，確定離開目前專案？'));
  async function open(id: string) {
    if (!confirmDiscard()) return;
    if (mutationLock.current) return;
    mutationLock.current = true; setBusy(true);
    try { const project = await loadProject(id); if (!project.engineering) { onLegacy(id); return; } setDoc(project.engineering); setUndo(project.engineeringHistory ?? []); setRedo([]); setSavedProject(project); setSelected([]); setDirty(false); setProjects(null); } catch { setError('無法開啟專案'); }
    finally { mutationLock.current = false; setBusy(false); }
  }
  function add(type: string) {
    const id = crypto.randomUUID();
    if (doc.mode === '3d') {
      const feature: GeometryFeature = { id, name: type, type: type as GeometryFeature['type'], params: type === 'box' ? { width: 80, height: 40, depth: 12 } : type === 'cylinder' ? { radius: 6, height: 20 } : { radius: 10 }, inputs: [] };
      void commit({ ...doc, features: [...doc.features, feature] });
    } else {
      const entity: VectorEntity = { id, type: type as VectorEntity['type'], layer: 'geometry', params: type === 'rect' ? { x: 0, y: 0, width: 80, height: 40 } : type === 'circle' ? { x: 20, y: 20, radius: 6 } : { x1: 0, y1: 0, x2: 80, y2: 40 } };
      void commit({ ...doc, entities: [...doc.entities, entity] });
    }
    setSelected([id]);
  }
  function operation(type: GeometryFeature['type']) {
    const inputs = doc.features.filter(f => selected.includes(f.id)).map(f => f.id);
    const required = ['union', 'cut', 'intersect'].includes(type) ? 2 : 1;
    if (inputs.length !== required) { setError(`請選取 ${required} 個特徵`); return; }
    const id = crypto.randomUUID();
    const feature: GeometryFeature = { id, name: type, type, inputs, params: type === 'translate' ? { x: 10, y: 0, z: 0 } : ['fillet', 'chamfer'].includes(type) ? { radius: 1 } : {} };
    void commit({ ...doc, features: [...doc.features, feature] }); setSelected([id]);
  }
  async function exportFile(format: 'step' | 'stl' | 'svg' | 'sheet-svg' | 'dxf' | 'cut-dxf' | 'json') {
    try {
      const blob = format === 'json' ? new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }) : format === 'step' || format === 'stl' ? await client.current.request(doc, format) as Blob : new Blob([format === 'sheet-svg' ? exportDrawingSheet(doc) : format === 'svg' ? exportVectorSvg(doc) : exportVectorDxf(doc, format === 'cut-dxf')], { type: format === 'svg' || format === 'sheet-svg' ? 'image/svg+xml' : 'application/dxf' });
      download(blob, `${doc.name.replace(/[^\w\u3400-\u9fff.-]/g, '_')}${format === 'cut-dxf' ? '-cut.dxf' : format === 'sheet-svg' ? '-sheet.svg' : '.' + format}`); setStatus('已匯出');
    } catch (e) { setError(e instanceof Error ? e.message : '匯出失敗'); }
  }
  let aiReady = false; try { geometryProvider(settings, doc.mode === '3d' ? 'model3d' : 'drawing2d'); aiReady = true; } catch { /* settings button remains available */ }
  const items = doc.mode === '3d' ? doc.features : doc.entities;
  const item = items.find(it => selected.includes(it.id));
  const updateItem = (params: Record<string, number | string>) => { if (!item) return; const next = structuredClone(doc); const list = doc.mode === '3d' ? next.features : next.entities; const target = list.find(it => it.id === item.id)!; target.params = params; void commit(next); };
  return <div className="engineering-shell">
    <header className="engineering-header"><strong>AiCAD</strong><span className="engineering-divider"/><input aria-label="專案名稱" disabled={busy} value={doc.name} onChange={e => { setDoc({ ...doc, name: e.target.value }); setDirty(true); }} /><span>{dirty ? '未儲存' : '已就緒'}</span><div className="engineering-header__actions">
      <Button size="sm" disabled={busy} onClick={() => { if (confirmDiscard()) { setDoc(emptyEngineeringDocument(doc.mode)); setUndo([]); setRedo([]); setSavedProject(null); setDirty(false); setSelected([]); } }}>新建</Button>
      <Button size="sm" onClick={() => void listProjects().then(setProjects).catch(() => setError('無法載入專案'))}>開啟</Button><Button size="sm" onClick={() => void save()}>儲存</Button><Button size="sm" disabled={busy} onClick={() => setSettingsOpen(true)}>設定</Button><Button size="sm" onClick={() => { if (confirmDiscard()) onLegacy(); }}>舊圖面</Button>
    </div></header>
    <aside className="engineering-brief"><fieldset disabled={busy} className="engineering-edit-fields">
      <div className="engineering-section"><h2>建立內容</h2><Segmented ariaLabel="生成內容類型" value={doc.mode} options={[{ value: '3d', label: '3D 模型' }, { value: '2d', label: '2D 圖紙' }]} onChange={mode => { if (mode !== doc.mode && confirmDiscard()) { setDoc(emptyEngineeringDocument(mode)); setUndo([]); setRedo([]); setSavedProject(null); setDirty(false); setSelected([]); } }} /><Field label="描述你的設計"><textarea rows={5} value={prompt} onChange={e => setPrompt(e.target.value)} placeholder={doc.mode === '3d' ? '80 × 40 × 12 mm 底板，兩個直徑 12 mm 通孔…' : '建立底板正視圖，標註孔位與外形尺寸…'} /></Field><div className="geometry-inline"><Button size="sm" disabled={busy || !aiReady || !prompt.trim()} onClick={() => void generate(false, true)}>精煉提示詞</Button><Button size="sm" variant="primary" disabled={busy || !aiReady || !prompt.trim()} onClick={() => void generate()}>生成{doc.mode === '3d' ? '模型' : '圖紙'}</Button></div>{!aiReady && <p className="field__hint">在設定中啟用文字供應商，再選擇下方模型。</p>}</div>
      <ReferencePanel value={refs} onChange={setRefs} />
      <details className="engineering-section" open><summary>{doc.mode === '3d' ? '建模設定' : '製圖設定'}</summary><EngineeringSettings value={doc.settings} mode={doc.mode} onChange={value => void commit({ ...doc, settings: value })} /></details>
      <details className="engineering-section"><summary>AI 模型分工</summary><GeometryModels settings={settings} onChange={onSettings} /></details>
    </fieldset></aside>
    <main className="engineering-main"><nav className="engineering-tools" aria-label="幾何工具">
      <Button size="sm" disabled={!undo.length || busy} onClick={() => { setRedo(old => [...old, doc]); setDoc(undo[undo.length - 1]); setUndo(old => old.slice(0, -1)); setDirty(true); }}>復原</Button><Button size="sm" disabled={!redo.length || busy} onClick={() => { setUndo(old => [...old, doc]); setDoc(redo[redo.length - 1]); setRedo(old => old.slice(0, -1)); setDirty(true); }}>重做</Button>
      {(doc.mode === '3d' ? [{ type: 'box', label: '方體' }, { type: 'cylinder', label: '圓柱' }, { type: 'sphere', label: '球體' }] : [{ type: 'line', label: '直線' }, { type: 'rect', label: '矩形' }, { type: 'circle', label: '圓' }]).map(tool => <Button key={tool.type} size="sm" disabled={busy} onClick={() => add(tool.type)}>{tool.label}</Button>)}
      {doc.mode === '3d' && ['iso', 'front', 'top', 'right'].map((direction, i) => <Button key={direction} size="sm" onClick={() => setView(direction)}>{['等角', '正視', '俯視', '右視'][i]}</Button>)}
      {doc.mode === '3d' && <details className="engineering-operations"><summary>實體操作</summary><div>{(['union', 'cut', 'intersect', 'translate', 'fillet', 'chamfer'] as const).map((type, index) => <Button key={type} size="sm" disabled={busy || selected.length !== (index < 3 ? 2 : 1)} onClick={() => operation(type)}>{['聯集', '差集（依樹順序）', '交集', '平移', '全邊圓角', '全邊倒角'][index]}</Button>)}</div></details>}
      {doc.mode === '3d' && <Button size="sm" disabled={busy || !result?.bodies.length} onClick={() => { if (mutationLock.current || busy) return; mutationLock.current = true; setBusy(true); setError(''); void client.current.request(doc, 'projection').then(next => { mutationLock.current = false; return commit({ ...next as EngineeringDocument, id: doc.id }); }).catch(e => { setError(e.message); }).finally(() => { mutationLock.current = false; setBusy(false); }); }}>投影 2D</Button>}
      <span className="engineering-tools__spacer"/>{(doc.mode === '3d' ? ['step', 'stl', 'json'] : ['svg', 'sheet-svg', 'dxf', 'cut-dxf', 'json']).map(format => <Button key={format} size="sm" disabled={busy || !items.length} onClick={() => void exportFile(format as Parameters<typeof exportFile>[0])}>{format === 'cut-dxf' ? '切割 DXF · 1:1' : format === 'sheet-svg' ? '圖紙 SVG' : format.toUpperCase()}</Button>)}
    </nav><div className="engineering-stage">{doc.mode === '3d' ? <GeometryViewport result={result} selected={selected} onSelect={select} upAxis={doc.settings.upAxis} view={view} /> : <VectorViewport document={doc} selected={selected} onSelect={select} />}{!items.length && <div className="engineering-empty"><h1>{doc.mode === '3d' ? '從設計意圖到精準實體' : '建立可以繼續編輯的圖紙'}</h1><p>輸入需求由 AI 建立，或使用上方工具開始。</p></div>}</div>
      <form className="engineering-command" onSubmit={e => { e.preventDefault(); void generate(selected.length > 0); }}><input aria-label="AI 修改指令" value={command} onChange={e => setCommand(e.target.value)} placeholder={selected.length ? `修改選取的 ${selected.length} 個項目…` : '修改整份設計…'} /><Button size="sm" type="submit" disabled={busy || !aiReady || !command.trim()}>{selected.length ? '局部修改' : '全面修改'}</Button>{busy && <Button size="sm" onClick={() => controller.current?.abort()}>取消</Button>}</form>
      <footer className="engineering-status" role="status">{error || status}<span>{doc.mode.toUpperCase()} · {doc.settings.units} · {items.length} 項目{result ? ` · 體積 ${result.volume.toFixed(doc.settings.precision)} ${doc.settings.units}³ · 重量 ${(result.volume * (doc.settings.units === 'in' ? 16.387064 : 0.001) * doc.settings.density).toFixed(doc.settings.precision)} g` : ''}</span></footer>
    </main>
    <aside className="engineering-inspector"><fieldset disabled={busy} className="engineering-edit-fields"><h2>{doc.mode === '3d' ? '特徵樹' : '圖層與實體'}</h2><div className="engineering-tree">{items.map((it, index) => <button key={it.id} className={selected.includes(it.id) ? 'is-selected' : ''} onClick={e => select(it.id, e.ctrlKey || e.metaKey)}><span>{String(index + 1).padStart(2, '0')}</span>{'name' in it ? it.name : `${it.layer} / ${it.type}`}</button>)}</div>
      {item && <div className="engineering-section"><h3>參數</h3>{Object.entries(item.params).map(([key, value]) => <Field key={`${item.id}-${key}-${value}`} label={key}><input defaultValue={String(value)} onBlur={e => { if (e.target.value !== String(value)) updateItem({ ...item.params, [key]: Number.isFinite(Number(e.target.value)) && e.target.value.trim() ? Number(e.target.value) : e.target.value }); }} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} /></Field>)}<Button size="sm" disabled={busy} onClick={() => { if (!window.confirm('刪除選取項目？相依特徵需要先移除。')) return; void commit({ ...doc, features: doc.features.filter(it => !selected.includes(it.id)), entities: doc.entities.filter(it => !selected.includes(it.id)) }); }}>刪除選取</Button></div>}
      {doc.mode === '2d' && selected.length > 0 && <div className="engineering-section"><h3>選取實體操作</h3>{(['x', 'y', 'count'] as const).map(key => <Field key={key} label={key === 'count' ? '陣列總份數' : `${key.toUpperCase()} 位移（${doc.settings.units}）`}><input type="number" value={offset[key]} onChange={e => setOffset({ ...offset, [key]: Number(e.target.value) })} /></Field>)}<Button size="sm" onClick={() => { try { void commit({ ...doc, entities: doc.entities.map(entity => selected.includes(entity.id) ? moveVector(entity, doc, offset.x, offset.y) : entity) }); } catch (e) { setError((e as Error).message); } }}>移動</Button><Button size="sm" onClick={() => { try { void commit(arrayVectors(doc, selected, offset.count, offset.x, offset.y)); } catch (e) { setError((e as Error).message); } }}>建立線性陣列</Button><Field label="選取實體圖層"><input key={selected.join(',')} defaultValue={doc.entities.find(entity => selected.includes(entity.id))?.layer ?? 'geometry'} onBlur={e => { const layer = e.target.value.trim(); if (layer) void commit({ ...doc, entities: doc.entities.map(entity => selected.includes(entity.id) ? { ...entity, layer } : entity) }); }} /></Field></div>}
      <details className="engineering-section"><summary>共用參數</summary>{Object.entries(doc.parameters).map(([key, value]) => <Field label={key} key={`${key}-${value}`}><input defaultValue={String(value)} onBlur={e => void commit({ ...doc, parameters: { ...doc.parameters, [key]: e.target.value } })} /></Field>)}</details>
      <div className="engineering-section"><Button size="sm" onClick={() => importInput.current?.click()}>匯入幾何 JSON</Button><input hidden type="file" accept=".json" ref={importInput} onChange={e => { const file = e.target.files?.[0]; if (file && file.size < 5000000) void file.text().then(text => commit({ ...validateEngineeringDocument(JSON.parse(text)), id: doc.id })).catch(() => setError('無效幾何文件')); e.target.value = ''; }} /></div>
    </fieldset></aside>
    {settingsOpen && <SettingsSheet settings={settings} onChange={onSettings} initialCategory={settingsCategory ?? undefined} onClose={() => { setSettingsOpen(false); onSettingsCategory(null); }} />}
    {projects && <div className="engineering-modal-backdrop"><section className="engineering-modal" role="dialog" aria-modal="true" aria-label="專案清單"><h2>開啟專案</h2>{projects.length === 0 && <p>尚無已儲存專案</p>}{projects.map(project => <div className="geometry-inline" key={project.id}><Button onClick={() => void open(project.id)}>{project.name}</Button><Button size="sm" onClick={() => { if (window.confirm(`刪除「${project.name}」？`)) void deleteProject(project.id).then(() => listProjects().then(setProjects)); }}>刪除</Button></div>)}<Button onClick={() => setProjects(null)}>關閉</Button></section></div>}
  </div>;
}
