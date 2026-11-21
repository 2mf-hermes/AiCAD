import type { Settings } from '../settings';
import type { ProviderConfig } from '../providers/types';
export type GeometryRole = 'unified' | 'refine' | 'model3d' | 'drawing2d' | 'vision';
export interface ModelBinding { providerId: string; model: string }
export interface GeometryModels { mode: 'unified' | 'separate'; bindings: Record<GeometryRole, ModelBinding> }
export const defaultGeometryModels = (): GeometryModels => ({ mode: 'unified', bindings: Object.fromEntries(['unified', 'refine', 'model3d', 'drawing2d', 'vision'].map(role => [role, { providerId: '', model: '' }])) as GeometryModels['bindings'] });
export function normalizeGeometryModels(value: unknown): GeometryModels {
  const result = defaultGeometryModels();
  if (!value || typeof value !== 'object') return result;
  const raw = value as Partial<GeometryModels>;
  result.mode = raw.mode === 'separate' ? 'separate' : 'unified';
  for (const role of Object.keys(result.bindings) as GeometryRole[]) {
    const binding = raw.bindings?.[role];
    if (binding && typeof binding.providerId === 'string' && typeof binding.model === 'string') result.bindings[role] = { providerId: binding.providerId, model: binding.model };
  }
  return result;
}
export function geometryProvider(settings: Settings, role: GeometryRole): ProviderConfig {
  const models = settings.geometryModels ?? defaultGeometryModels();
  const binding = models.bindings[models.mode === 'unified' ? 'unified' : role];
  const unified = models.bindings.unified;
  const providerId = binding.providerId || unified.providerId || settings.activeTextProvider;
  const provider = settings.providers.find(p => p.id === providerId && p.enabled && p.capabilities.text);
  if (!provider) throw new Error('請先設定並啟用 AI 文字模型');
  const model = binding.model || (binding.providerId ? '' : unified.model) || (role === 'vision' ? provider.visionModel : provider.textModel) || provider.textModel;
  if (!model) throw new Error('請先選擇 AI 模型');
  return { ...provider, textModel: model, visionModel: model };
}
