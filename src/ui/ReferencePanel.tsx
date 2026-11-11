import { useRef, useState } from 'react';
import type { ReferenceAttachment } from '../core/types';
import { readReference, REFERENCE_LIMIT } from '../core/references';
import { userFacingReason } from '../core/net/friendly';
import { Section } from './primitives';
export function ReferencePanel({ value, onChange }: { value: ReferenceAttachment[]; onChange: (value: ReferenceAttachment[]) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
return <Section variant="block" title="參考圖片與檔案">
    {/* 一句話講完風險就好；其餘細節屬實作，使用者不需要在每次上傳前重讀。 */}
    <p className="field__hint">圖片與文件會傳送給已設定的 AI 服務分析，請勿上傳不宜外傳的資料。</p>
    <div className="reference-picker">
      <input ref={inputRef} className="reference-picker__input" aria-label="上傳參考資料" type="file" multiple disabled={busy} accept="image/png,image/jpeg,image/webp,.txt,.md,.csv,.json,.xml,.yaml,.yml,.log" onChange={async e => {
      const files = Array.from(e.target.files ?? []); e.target.value = ''; setError(''); setBusy(true);
      try {
        if (files.length + value.length > REFERENCE_LIMIT) throw new Error('最多 4 個附件，每張圖片 2 MiB、文字檔 64 KB');
        onChange([...value, ...await Promise.all(files.map(readReference))]);
      } catch (e) {
        // 只給一句人話：讀取失敗時不揭露來源與內部細節。
        setError(userFacingReason(e instanceof Error ? e.message : String(e), '讀取參考檔案失敗，請確認檔案格式與大小後再試一次'));
      } finally { setBusy(false); }
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
