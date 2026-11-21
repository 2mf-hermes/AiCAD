import type { EngineeringSettings as Values, GeometryMode } from '../core/geometry/document';
import { Field, Select } from './primitives';
export function EngineeringSettings({ value, mode, onChange }: { value: Values; mode: GeometryMode; onChange: (value: Values) => void }) {
  const set = <K extends keyof Values>(key: K, val: Values[K]) => onChange({ ...value, [key]: val });
  const numeric = (key: 'precision' | 'tolerance' | 'meshTolerance' | 'density' | 'scale', label: string, min: number, max: number, step = 1) => <Field label={label}><input type="number" min={min} max={max} step={step} value={value[key]} onChange={e => { const n = Number(e.target.value); if (Number.isFinite(n) && n >= min && n <= max) set(key, n); }} /></Field>;
  return <div className="geometry-fields">
    <Field label="單位"><Select value={value.units} options={[{ value: 'mm', label: 'MMGS · mm' }, { value: 'in', label: 'IPS · inch' }]} onChange={v => set('units', v)} /></Field>
    {numeric('precision', '顯示小數位', 0, 6)}
    {mode === '3d' ? <>
      <Field label="向上軸"><Select value={value.upAxis} options={[{ value: 'Z', label: 'Z' }, { value: 'Y', label: 'Y' }]} onChange={v => set('upAxis', v)} /></Field>
      {numeric('tolerance', '建模公差', 0.0001, 0.1, 0.001)}
      {numeric('meshTolerance', '網格弦高公差', 0.01, 5, 0.01)}
      <Field label="材質"><input value={value.material} onChange={e => set('material', e.target.value)} /></Field>
      {numeric('density', '密度（g/cm³）', 0.001, 100, 0.01)}
    </> : <>
      <Field label="製圖標準"><Select value={value.standard} options={['ISO', 'JIS', 'ASME', 'CNS'].map(v => ({ value: v, label: v }))} onChange={v => set('standard', v as Values['standard'])} /></Field>
      <Field label="投影法"><Select value={value.projection} options={[{ value: 'third', label: '第三角法' }, { value: 'first', label: '第一角法' }]} onChange={v => set('projection', v)} /></Field>
      <Field label="圖幅"><Select value={value.paper} options={['A4', 'A3', 'A2', 'A1', 'A0'].map(v => ({ value: v, label: v }))} onChange={v => set('paper', v as Values['paper'])} /></Field>
      {numeric('scale', '圖紙比例係數', 0.01, 100, 0.1)}
      <Field label="一般公差"><input value={value.generalTolerance} onChange={e => set('generalTolerance', e.target.value)} /></Field>
    </>}
    <Field label="品名"><input value={value.title} onChange={e => set('title', e.target.value)} /></Field>
    <Field label="料號"><input value={value.partNumber} onChange={e => set('partNumber', e.target.value)} /></Field>
    <Field label="版次"><input value={value.revision} onChange={e => set('revision', e.target.value)} /></Field>
  </div>;
}
