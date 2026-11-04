import { useRef, useState } from 'react';
import type { ReferenceAttachment } from '../core/types';
import { readReference, REFERENCE_LIMIT } from '../core/references';
import { Section } from './primitives';
export function ReferencePanel({ value, onChange }: { value: ReferenceAttachment[]; onChange: (value: ReferenceAttachment[]) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return <Section title="參考圖片與文件">
    <p>圖片由視圖模型辨識，文字／CSV／JSON 由主文字模型分析。生成時會傳送至所設定的 AI Provider，請勿上傳無權分享的資料。</p>
    <div className="reference-picker">
      <input ref={inputRef} className="reference-picker__input" aria-label="上傳參考資料" type="file" multiple disabled={busy} accept="image/png,image/jpeg,image/webp,.txt,.md,.csv,.json,.xml,.yaml,.yml,.log" onChange={async e => {
      const files = Array.from(e.target.files ?? []); e.target.value = ''; setError(''); setBusy(true);
      try {
        if (files.length + value.length > REFERENCE_LIMIT) throw new Error('最多 4 個附件，每張圖片 2 MiB、文字檔 64 KB');
        onChange([...value, ...await Promise.all(files.map(readReference))]);
      } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
      }} />
      <button type="button" className="btn btn--secondary reference-picker__button" disabled={busy || value.length >= REFERENCE_LIMIT} onClick={() => inputRef.current?.click()}>
        {busy ? '正在讀取…' : '選擇參考檔案'}
      </button>
      <span className="field__hint num">{value.length} / {REFERENCE_LIMIT}</span>
    </div>
    {busy && <p role="status">正在讀取參考檔案…</p>}
    {error && <p role="alert">{error}</p>}
    {value.map(ref => <div key={ref.id} style={{display:'flex',gap:8,alignItems:'center',minWidth:0}}>
      {ref.mimeType.startsWith('image/') && <img src={ref.dataUrl} alt="" style={{width:48,height:48,objectFit:'contain'}} />}
      <span style={{overflowWrap:'anywhere',flex:1}}>{ref.name}</span>
      <button type="button" className="btn btn--ghost btn--sm" disabled={busy} aria-label={`移除 ${ref.name}`} onClick={() => onChange(value.filter(r => r.id !== ref.id))}>移除</button>
    </div>)}
  </Section>;
}
