/* ============================================================================
   i18n — Provider 與取詞 hook
   ----------------------------------------------------------------------------
   設計取捨：

   1) 五份字典全部靜態 import，不做動態 import 分包。
      理由：整個 App 最終要被 go:embed 進單一 EXE、離線執行；分包只是把同一顆
      EXE 裡的位元組換個檔名，卻換來「切語言時要等載入」的閃動與失敗路徑。
      五份字典合計數十 KB，一次載入更單純也更快。

   2) 取詞是 `const t = useT()` 回傳「整份字典物件」，不是 `t('a.b.c')` 字串鍵。
      理由：物件路徑有型別，拼錯鍵當場編譯失敗、IDE 可自動補全、帶參數的字串
      參數型別也被檢查。字串鍵的 API 要靠額外工具才能達到同樣安全。

   3) 語言的「真實來源」是 settings（會被寫進 %APPDATA%），這裡只從 App 接收
      locale 當 prop。i18n 不自己讀寫儲存，避免兩個地方各持一份語言狀態。
   ========================================================================== */

import { createContext, createElement, useContext, useEffect, type ReactNode } from 'react';
import { DEFAULT_LOCALE, LOCALE_TAG, type Locale } from './locales';
import { zhHant, type Dict } from './dict/zh-Hant';
import { zhHans } from './dict/zh-Hans';
import { en } from './dict/en';
import { ja } from './dict/ja';
import { ko } from './dict/ko';

export const DICTS: Record<Locale, Dict> = {
  'zh-Hant': zhHant,
  'zh-Hans': zhHans,
  en,
  ja,
  ko,
};

export function dictFor(locale: Locale): Dict {
  return DICTS[locale] ?? DICTS[DEFAULT_LOCALE];
}

interface I18nValue {
  locale: Locale;
  t: Dict;
}

/** 預設值用繁中：讓 Provider 之外的元件（測試、Storybook）也不會炸。 */
const I18nContext = createContext<I18nValue>({ locale: DEFAULT_LOCALE, t: zhHant });

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  // 同步 <html lang>：影響斷行規則、字型 fallback 與螢幕閱讀器發音，
  // 是 CJK 混排下實際看得出差異的一項（不是形式上的無障礙標記）。
  useEffect(() => {
    document.documentElement.lang = LOCALE_TAG[locale] ?? locale;
  }, [locale]);

  return createElement(
    I18nContext.Provider,
    { value: { locale, t: dictFor(locale) } },
    children,
  );
}

/** 取整份字典：`const t = useT(); t.settings.title` */
export function useT(): Dict {
  return useContext(I18nContext).t;
}

/** 少數需要知道「當前是哪個語言」的地方（日期格式、字型調整）。 */
export function useLocale(): Locale {
  return useContext(I18nContext).locale;
}

/** 依當前語言格式化時間戳，用於「上次檢查更新」等處。 */
export function formatDateTime(locale: Locale, iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return new Intl.DateTimeFormat(LOCALE_TAG[locale], {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 16).replace('T', ' ');
  }
}

export { DEFAULT_LOCALE, LOCALES, LOCALE_LABEL, LOCALE_TAG, isLocale } from './locales';
export type { Locale } from './locales';
export type { Dict } from './dict/zh-Hant';
