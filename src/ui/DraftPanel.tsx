/* ============================================================================
   右欄「草稿」區塊（Draft Panel）
   ----------------------------------------------------------------------------
   流程上是：文字模型先精煉提示詞 → 再依精煉結果畫一張線稿草稿 → 生圖模型看草稿
   畫正式圖。中間那張草稿以前只在記憶體裡流過，使用者完全看不到，只能相信它存在。
   這裡把草稿與精煉後的提示詞一起攤在右欄，看得見才敢按產圖。

   顯示策略：草稿本身是 SVG 字串（已正規化、無外部資源），直接以 data URL 放進
   <img>，比 inline SVG 安全也省 DOM；藍圖樣式另外墊深色底，否則白線畫在白底上
   會整張「空白」。
   ========================================================================== */

import { useMemo } from 'react';
import { useT } from '../i18n';
import { Section } from './primitives';
import { svgDataUrl } from '../core/sheetSvg';
import type { DraftSvg } from '../core/pipeline/draft';

interface Props {
  draft: DraftSvg | null;
  /** 精煉後的提示詞（生圖前最後一次送出的版本）；空字串代表還沒精煉。 */
  prompt: string;
  /** 藍圖（深底白線）樣式。 */
  dark: boolean;
}

export function DraftPanel({ draft, prompt, dark }: Props) {
  const t = useT();
  const href = useMemo(() => {
    const svg = draft?.svg?.trim();
    return svg ? svgDataUrl(svg) : '';
  }, [draft]);

  const empty = !href && !prompt.trim();
  return (
    <Section variant="block" title={t.right.draftTitle}>
      {empty ? (
        <p className="empty-note">{t.right.draftEmpty}</p>
      ) : (
        <div className="draftpanel">
          {href ? (
            <div className={`draftpanel__preview${dark ? ' draftpanel__preview--dark' : ''}`}>
              <img src={href} alt={t.right.draftAlt} draggable={false} />
            </div>
          ) : (
            <p className="field__hint">{t.right.draftNoSketch}</p>
          )}
          {prompt.trim() && (
            <>
              <p className="field__hint">{t.right.draftPromptHint}</p>
              <textarea
                className="textarea selectable"
                readOnly
                style={{ minHeight: 96, fontSize: 'var(--fs-caption)' }}
                value={prompt}
              />
            </>
          )}
        </div>
      )}
    </Section>
  );
}
