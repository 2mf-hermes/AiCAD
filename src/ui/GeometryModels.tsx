import { useState } from 'react';
import type { Settings } from '../core/settings';
import { defaultGeometryModels, type GeometryRole } from '../core/geometry/models';
import { createProvider } from '../core/providers/provider';
import { Button, Field, Select, Segmented } from './primitives';
export function GeometryModels({ settings, onChange }: { settings: Settings; onChange: (settings: Settings) => void }) {
  const models = settings.geometryModels ?? defaultGeometryModels();
  const [lists, setLists] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const providers = settings.providers.filter(p => p.enabled && p.capabilities.text);
  const roles: { id: GeometryRole; label: string }[] = models.mode === 'unified' ? [{ id: 'unified', label: '統一模型' }] : [{ id: 'unified', label: '預設模型' }, { id: 'refine', label: '提示詞精煉' }, { id: 'model3d', label: '3D 建模' }, { id: 'drawing2d', label: '2D 製圖' }, { id: 'vision', label: '參考圖辨識' }];
  function update(role: GeometryRole, binding: { providerId: string; model: string }) { onChange({ ...settings, geometryModels: { ...models, bindings: { ...models.bindings, [role]: binding } } }); }
  async function load(id: string) {
    const provider = providers.find(p => p.id === id); if (!provider) return;
    setBusy(id); setError('');
    try { const loaded = await createProvider(provider).getModels(AbortSignal.timeout(30000)); setLists(previous => ({ ...previous, [id]: loaded })); }
    catch { setError('無法載入模型，請檢查供應商設定'); } finally { setBusy(''); }
  }
  return <div className="geometry-models">
    <Segmented ariaLabel="AI 模型分工方式" value={models.mode} options={[{ value: 'unified', label: '統一模型' }, { value: 'separate', label: '分別設定' }]} onChange={mode => onChange({ ...settings, geometryModels: { ...models, mode } })} />
    {roles.map(role => { const binding = models.bindings[role.id]; const effectiveId = binding.providerId || models.bindings.unified.providerId || settings.activeTextProvider;
      return <div key={role.id} className="geometry-models__role"><Field label={role.label}>
        <Select value={binding.providerId} options={[{ value: '', label: '跟隨預設文字供應商' }, ...providers.map(p => ({ value: p.id, label: p.name }))]} onChange={providerId => update(role.id, { providerId, model: '' })} />
        <div className="geometry-inline"><input aria-label={`${role.label}模型名稱`} placeholder="跟隨供應商模型" value={binding.model} onChange={e => update(role.id, { ...binding, model: e.target.value })} /><Button size="sm" disabled={!!busy || !providers.some(p => p.id === effectiveId)} onClick={() => void load(effectiveId)}>{busy === effectiveId ? '載入中' : '載入'}</Button></div>
        {!!lists[effectiveId]?.length && <Select value={binding.model} options={[{ value: '', label: '選擇模型' }, ...lists[effectiveId].map(model => ({ value: model, label: model }))]} onChange={model => update(role.id, { ...binding, model })} />}
      </Field></div>;
    })}
    {error && <p role="alert">{error}</p>}
  </div>;
}
