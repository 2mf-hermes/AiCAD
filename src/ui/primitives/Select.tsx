/* ============================================================================
   Select —— 自製下拉清單（取代原生 <select>）
   ----------------------------------------------------------------------------
   為什麼必須自製：原生 <select> 的**彈出清單**由作業系統繪製，CSS 完全碰不到。
   即使把收合狀態的外框做得再細緻，一點開就是 Windows 的灰底方框清單 —— 那正是
   「基本樣式」感的來源。這個元件用 button + listbox 重建，讓展開後的清單同樣
   套用 tokens 與 1px 邊框慣例。

   自製下拉最常見的三個退步，這裡都處理掉：
   1) 鍵盤不通 → 實作 ↑↓ / Home / End / Enter / Space / Esc 與字首跳轉，
      並用 aria-activedescendant 讓螢幕閱讀器跟得上。
   2) 被父層 overflow 裁掉 → 面板用 position: fixed 依觸發器的 rect 定位，
      不受 .panel__scroll 的 overflow 影響；空間不足時自動往上翻。
   3) 焦點掉了 → 關閉後把焦點還給觸發按鈕。
   ========================================================================== */

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  /** 次要說明，靠右對齊灰字顯示（例如「未啟用」、「本機」） */
  note?: string;
  disabled?: boolean;
  /**
   * 群組小標題。相鄰且同名的選項會被歸在同一個 role="group" 底下，
   * 並在上方顯示一行不可點選的標題。留空則不分組。
   * 注意：分組只看「相鄰」，所以 options 陣列本身要先排好序。
   */
  group?: string;
}

interface SelectProps<T extends string> {
  value: T;
  options: SelectOption<T>[];
  onChange: (v: T) => void;
  /** 無障礙名稱；若外層已用 <Field> 包住，可省略 */
  ariaLabel?: string;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  searchable?: boolean;
  searchPlaceholder?: string;
}

const PREFERRED_PANEL_H = 288; // 約 8 列；實際高度仍受應用程式外框限制
const MAX_PANEL_W = 360; // 寬欄位不應讓 popup 跟著撐滿；保留足夠空間顯示選項與說明
const FRAME_GAP = 6;
const FRAME_PADDING = 8;

export interface SelectPlacementInput {
  trigger: Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom' | 'width'>;
  frame: Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom'>;
}

/** 只依幾何資料計算選單位置，方便測試，也避免 portal 超出桌面應用程式外框。 */
export function calculateSelectPlacement({ trigger, frame }: SelectPlacementInput) {
  const leftBound = frame.left + FRAME_PADDING;
  const rightBound = frame.right - FRAME_PADDING;
  const topBound = frame.top + FRAME_PADDING;
  const bottomBound = frame.bottom - FRAME_PADDING;
  const below = Math.max(0, bottomBound - trigger.bottom - FRAME_GAP);
  const above = Math.max(0, trigger.top - topBound - FRAME_GAP);
  const drop: 'down' | 'up' = below >= Math.min(PREFERRED_PANEL_H, 160) || below >= above ? 'down' : 'up';
  const maxHeight = Math.max(0, Math.min(PREFERRED_PANEL_H, drop === 'down' ? below : above));
  const availableWidth = Math.max(0, rightBound - leftBound);
  const width = Math.min(Math.max(0, trigger.width), MAX_PANEL_W, availableWidth);
  const left = Math.max(leftBound, Math.min(trigger.left, rightBound - width));
  return {
    left,
    top: drop === 'down' ? trigger.bottom + FRAME_GAP : trigger.top - FRAME_GAP,
    width,
    maxHeight,
    drop,
    frameBottom: frame.bottom,
  };
}

export function Select<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  placeholder = '',
  disabled = false,
  id,
  searchable = false,
  searchPlaceholder = '',
}: SelectProps<T>) {
  const autoId = useId();
  const listId = `${id ?? autoId}-list`;
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [query, setQuery] = useState('');
  const [rect, setRect] = useState({ left: 0, top: 0, width: 0, maxHeight: PREFERRED_PANEL_H, drop: 'down' as 'down' | 'up', frameBottom: window.innerHeight });

  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const typeahead = useRef({ buffer: '', at: 0 });

  const selectedIndex = useMemo(() => options.findIndex((o) => o.value === value), [options, value]);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;

  const place = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const shell = el.closest('.shell')?.getBoundingClientRect();
    const frame = shell ?? { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
    setRect(calculateSelectPlacement({ trigger: r, frame }));
  }, []);

  const close = useCallback((refocus = true) => {
    setOpen(false);
    setActiveIndex(-1);
    if (refocus) triggerRef.current?.focus();
  }, []);

  const openList = useCallback(
    (index: number) => {
      if (disabled) return;
      place();
      setActiveIndex(index);
      setOpen(true);
    },
    [disabled, place],
  );

  const commit = useCallback(
    (index: number) => {
      const opt = options[index];
      if (!opt || opt.disabled) return;
      onChange(opt.value);
      close();
    },
    [close, onChange, options],
  );

  /** 跳過 disabled 選項的步進 */
  const step = useCallback(
    (from: number, dir: 1 | -1): number => {
      const n = options.length;
      if (n === 0) return -1;
      for (let i = 1; i <= n; i += 1) {
        const idx = (from + dir * i + n * (i + 1)) % n;
        if (!options[idx].disabled) return idx;
      }
      return from;
    },
    [options],
  );

  // 開啟期間跟隨捲動與縮放重新定位。fixed 定位的代價就是這個，
  // 但比被 overflow 裁掉划算得多。
  useEffect(() => {
    if (!open) return;
    const onScroll = () => place();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open, place]);

  // 點擊外部關閉：用 pointerdown 而非 click，避免在按下瞬間就發生的畫面跳動
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      close(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [open, close]);

  // 讓 active 項保持在可見範圍內
  useLayoutEffect(() => {
    if (!open || activeIndex < 0) return;
    panelRef.current
      ?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;

    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openList(selectedIndex >= 0 ? selectedIndex : step(-1, 1));
      }
      return;
    }

    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        close();
        break;
      case 'Tab':
        close(false);
        break;
      case 'ArrowDown':
        e.preventDefault();
        setActiveIndex((i) => step(i < 0 ? -1 : i, 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActiveIndex((i) => step(i < 0 ? 0 : i, -1));
        break;
      case 'Home':
        e.preventDefault();
        setActiveIndex(step(-1, 1));
        break;
      case 'End':
        e.preventDefault();
        setActiveIndex(step(0, -1));
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        commit(activeIndex);
        break;
      default:
        // 字首跳轉：1 秒內連打視為同一個字串
        if (e.key.length === 1 && !e.altKey && !e.ctrlKey && !e.metaKey) {
          const now = Date.now();
          const buf = now - typeahead.current.at < 1000 ? typeahead.current.buffer + e.key : e.key;
          typeahead.current = { buffer: buf, at: now };
          const q = buf.toLowerCase();
          const hit = options.findIndex((o) => !o.disabled && o.label.toLowerCase().startsWith(q));
          if (hit >= 0) setActiveIndex(hit);
        }
    }
  };

  /**
   * 把 options 切成連續的區塊：有 group 的相鄰選項合為一組。
   * 保留原始索引，鍵盤導覽（activeIndex）才不會因為分組而錯位。
   */
  const chunks = useMemo(() => {
    const out: { group?: string; items: { opt: SelectOption<T>; index: number }[] }[] = [];
    options.forEach((opt, index) => {
      if (query.trim() && !opt.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) return;
      const last = out[out.length - 1];
      if (last && last.group === opt.group) last.items.push({ opt, index });
      else out.push({ group: opt.group, items: [{ opt, index }] });
    });
    return out;
  }, [options, query]);

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className="xselect"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        aria-activedescendant={open && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
        disabled={disabled}
        data-open={open}
        onKeyDown={onKeyDown}
        onClick={() => (open ? close() : openList(selectedIndex >= 0 ? selectedIndex : step(-1, 1)))}
      >
        <span className="xselect__value" data-placeholder={!selected}>
          {selected?.label ?? placeholder}
        </span>
        {selected?.note && <span className="xselect__note">{selected.note}</span>}
        <svg
          className="xselect__chevron"
          width="12"
          height="12"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M5.6 8.2L10 12.4l4.4-4.2" />
        </svg>
      </button>

      {open && (
        <div
          ref={panelRef}
          className="xselect__panel"
          data-drop={rect.drop}
          style={{
            left: rect.left,
            width: rect.width,
            maxHeight: rect.maxHeight,
            ...(rect.drop === 'down'
              ? { top: rect.top }
              : { bottom: rect.frameBottom - rect.top }),
          }}
        >
          {searchable && (
            <input
              className="input xselect__search"
              type="search"
              value={query}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            />
          )}
          <div className="xselect__list" role="listbox" id={listId} aria-label={ariaLabel} tabIndex={-1}>
            {chunks.map((chunk, ci) => {
              const rows = chunk.items.map(({ opt: o, index: i }) => (
                <div
                  key={o.value}
                  id={`${listId}-${i}`}
                  data-index={i}
                  role="option"
                  aria-selected={o.value === value}
                  aria-disabled={o.disabled}
                  className="xselect__option"
                  data-active={i === activeIndex}
                  onPointerEnter={() => !o.disabled && setActiveIndex(i)}
                  onClick={() => commit(i)}
                >
                  <svg
                    className="xselect__tick"
                    width="13"
                    height="13"
                    viewBox="0 0 20 20"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.9"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M4.2 10.6l3.6 3.4 8-8.2" />
                  </svg>
                  <span className="xselect__label">{o.label}</span>
                  {o.note && <span className="xselect__note">{o.note}</span>}
                </div>
              ));

              if (!chunk.group) return <div key={`c${ci}`}>{rows}</div>;
              const gid = `${listId}-g${ci}`;
              return (
                <div key={`c${ci}`} role="group" aria-labelledby={gid} className="xselect__group">
                  <div id={gid} className="xselect__grouplabel" aria-hidden="true">
                    {chunk.group}
                  </div>
                  {rows}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
