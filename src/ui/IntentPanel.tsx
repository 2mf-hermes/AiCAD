import { useCallback } from 'react';
import {
  DRAWING_KINDS,
  DRAWING_KIND_GROUP,
  DRAWING_TEXT_LANGUAGES,
  LINE_STYLES,
  LINE_STYLE_GROUP,
  type DrawingIntent,
  type DrawingKind,
  type DrawingTextLanguage,
  type DrawingTextRenderMode,
  type LineStyle,
  type Unit,
} from '../core/types';
import { useT } from '../i18n';
import { IconClose } from './icons';
import { Field, Section, Segmented, Select, Toggle } from './primitives';
import { ReferencePanel } from './ReferencePanel';

interface Props {
  intent: DrawingIntent;
  onChange: (next: DrawingIntent) => void;
}

/** 尺寸清單以陣列在 UI 中操作，送出前才轉回 Record —— 避免鍵名重複時輸入被吃掉 */
export function IntentPanel({ intent, onChange }: Props) {
  const t = useT();
  const rows = Object.entries(intent.measurements);

  const setMeasurements = useCallback(
    (next: [string, string][]) => {
      const rec: Record<string, string> = {};
      for (const [k, v] of next) rec[k] = v;
      onChange({ ...intent, measurements: rec });
    },
    [intent, onChange],
  );

  const patchAnnotation = useCallback(
    (delta: Partial<DrawingIntent['annotation']>) => {
      onChange({ ...intent, annotation: { ...intent.annotation, ...delta } });
    },
    [intent, onChange],
  );

  const patchText = useCallback(
    (delta: Partial<DrawingIntent['text']>) => {
      onChange({ ...intent, text: { ...intent.text, ...delta } });
    },
    [intent, onChange],
  );

  /* 自訂欄位只動指定那一列：改一個字不會重建整個陣列參考，輸入焦點才不會跳掉。 */
  const patchCustomField = useCallback(
    (index: number, delta: Partial<DrawingIntent['text']['customFields'][number]>) => {
      patchText({
        customFields: intent.text.customFields.map((item, i) => (i === index ? { ...item, ...delta } : item)),
      });
    },
    [intent, patchText],
  );

  const removeCustomField = useCallback(
    (index: number) => {
      patchText({ customFields: intent.text.customFields.filter((_, i) => i !== index) });
    },
    [intent, patchText],
  );

  const clearCustomFields = useCallback(() => {
    patchText({ customFields: [] });
  }, [patchText]);

  return (
    <>
      <Section variant="block" title={t.intent.kindSection}>
        <Field label={t.intent.kindLabel} hint={t.intent.kindHint}>
          <Select<DrawingKind>
            ariaLabel={t.intent.kindLabel}
            value={intent.kind}
            onChange={(kind) => onChange({ ...intent, kind })}
            options={DRAWING_KINDS.map((k) => ({
              value: k,
              label: t.kind[k],
              group: t.group[DRAWING_KIND_GROUP[k]],
            }))}
          />
        </Field>

        <Field label={t.intent.subject} hint={t.intent.subjectHint}>
          <textarea
            className="textarea"
            value={intent.subject}
            placeholder={t.intent.subjectPlaceholder}
            onChange={(e) => onChange({ ...intent, subject: e.target.value })}
          />
        </Field>
        <Field label="類別內容" hint="補充所選類別的用途、組成、視圖與交付範圍，會一併送入提示詞。">
          <textarea
            className="textarea"
            value={intent.categoryContent}
            placeholder="例如：包含本體、固定孔、剖視要求與裝配關係"
            onChange={(e) => onChange({ ...intent, categoryContent: e.target.value })}
          />
        </Field>
      </Section>

      <ReferencePanel value={intent.references ?? []} onChange={(references) => onChange({ ...intent, references })} />

      <Section variant="block" title={t.intent.annotationSection}>
        {/* 標註分兩類：一類寫進提示詞（生圖前決定），一類由應用程式疊加（隨時可改）。
            先講清楚差別，使用者才不會生完圖才發現少畫了尺寸線。 */}
        <p className="field__hint">{t.intent.annotationPreHint}</p>
        {/* 圖面文字模式屬於「生圖前就要決定」的項目：它會改變圖面本身的畫法，
            所以放在這裡而不是語言與文字區塊。只留兩種：應用程式疊加、生圖模型繪製。 */}
        <Field label={t.intent.textRenderMode} hint={t.intent.textRenderModeHint}>
          <Select<DrawingTextRenderMode>
            ariaLabel={t.intent.textRenderMode}
            value={intent.text.renderMode === 'text-model-overlay' ? 'application' : intent.text.renderMode}
            onChange={(renderMode) => patchText({ renderMode })}
            options={[
              { value: 'application', label: t.intent.textRenderApplication },
              { value: 'image-model', label: t.intent.textRenderImageModel },
            ]}
          />
        </Field>
        <div>
          <Toggle
            label={t.intent.dimensions}
            description={t.intent.dimensionsHint}
            checked={intent.annotation.dimensions}
            onChange={(dimensions) => patchAnnotation({ dimensions })}
          />
          <Toggle
            label={t.intent.tolerance}
            description={t.intent.toleranceHint}
            checked={intent.annotation.tolerance}
            onChange={(tolerance) => patchAnnotation({ tolerance })}
          />
          <Toggle
            label={t.intent.gdt}
            description={t.intent.gdtHint}
            checked={intent.annotation.gdt}
            onChange={(gdt) => patchAnnotation({ gdt })}
          />
          <Toggle
            label={t.intent.callouts}
            checked={intent.annotation.callouts}
            onChange={(callouts) => patchAnnotation({ callouts })}
          />
        </div>

        <p className="field__hint">{t.intent.annotationPostHint}</p>
        <div>
          <Toggle
            label={t.intent.titleBlock}
            description={t.intent.titleBlockHint}
            checked={intent.annotation.titleBlock}
            onChange={(titleBlock) => patchAnnotation({ titleBlock })}
          />
          {intent.annotation.titleBlock && (
            <div className="intent-subblock">
              <Field label={t.intent.sheetTitle} hint={t.intent.sheetTitleHint}>
                <input className="input" value={intent.text.title} onChange={(e) => patchText({ title: e.target.value })} />
              </Field>
              <Field label={t.intent.sheetDate} hint={t.intent.sheetDateHint}>
                <div className="dimrow">
                  <input
                    className="input"
                    type="date"
                    value={/^\d{4}-\d{2}-\d{2}$/.test(intent.text.date) ? intent.text.date : ''}
                    onChange={(e) => patchText({ date: e.target.value })}
                  />
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => patchText({ date: new Date().toISOString().slice(0, 10) })}>
                    {t.intent.dateToday}
                  </button>
                </div>
              </Field>
              <div className="dimrow">
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => patchText({ customFields: [...intent.text.customFields, { key: '', value: '' }] })}>
                  {t.intent.addField}
                </button>
              </div>
              {intent.text.customFields.map((field, index) => (
                <div className="dimrow dimrow--field" key={`title-field-${index}`}>
                  <input
                    className="input"
                    value={field.key}
                    placeholder={t.common.name}
                    onChange={(e) => patchCustomField(index, { key: e.target.value })}
                  />
                  <input
                    className="input"
                    value={field.value}
                    placeholder={t.intent.fieldValue}
                    onChange={(e) => patchCustomField(index, { value: e.target.value })}
                  />
                  {/* 刪除自訂欄位：一列一顆，最後一列也留著，避免整塊設定突然消失。 */}
                  <button
                    type="button"
                    className="iconbtn"
                    title={t.intent.removeRow(field.key || t.intent.thisRow)}
                    aria-label={t.intent.removeRow(field.key || t.intent.thisRow)}
                    onClick={() => removeCustomField(index)}
                  >
                    <IconClose size={14} />
                  </button>
                </div>
              ))}
              {intent.text.customFields.length > 0 && (
                <div className="dimrow dimrow--actions">
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => clearCustomFields()}>
                    {t.intent.clearFields}
                  </button>
                </div>
              )}
            </div>
          )}
          <Toggle
            label={t.intent.scaleBar}
            description={t.intent.scaleBarHint}
            checked={intent.annotation.scaleBar}
            onChange={(scaleBar) => patchAnnotation({ scaleBar })}
          />
        </div>
      </Section>

      <Section
        variant="block"
        title={t.intent.dimsSection}
        aside={
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => setMeasurements([...rows, ['', '']] as [string, string][])}
          >
            {t.common.add}
          </button>
        }
      >
        {rows.length === 0 ? (
          <p className="empty-note">{t.intent.dimsEmpty}</p>
        ) : (
          <div className="dimlist">
            {rows.map(([k, v], i) => (
              <div className="dimrow" key={`${i}-${k}`}>
                <input
                  className="input"
                  value={k}
                  placeholder={t.common.name}
                  onChange={(e) => {
                    const next = [...rows] as [string, string][];
                    next[i] = [e.target.value, v];
                    setMeasurements(next);
                  }}
                />
                <input
                  className="input num"
                  value={v}
                  placeholder={t.intent.dimValuePlaceholder}
                  onChange={(e) => {
                    const next = [...rows] as [string, string][];
                    next[i] = [k, e.target.value];
                    setMeasurements(next);
                  }}
                />
                <button
                  type="button"
                  className="iconbtn"
                  aria-label={t.intent.removeRow(k || t.intent.thisRow)}
                  onClick={() => setMeasurements(rows.filter((_, j) => j !== i) as [string, string][])}
                >
                  <IconClose size={14} />
                </button>
              </div>
            ))}
          </div>
        )}

        <Field label={t.intent.unit}>
          <Segmented<Unit>
            ariaLabel={t.intent.unit}
            value={intent.annotation.unit}
            onChange={(unit) => patchAnnotation({ unit })}
            options={[
              { value: 'mm', label: 'mm' },
              { value: 'cm', label: 'cm' },
              { value: 'm', label: 'm' },
              { value: 'in', label: 'in' },
            ]}
          />
        </Field>
      </Section>

      <Section variant="block" title={t.intent.specSection}>
        <Field label={t.intent.projection} hint={t.intent.projectionHint}>
          <Segmented<'first' | 'third'>
            ariaLabel={t.intent.projection}
            value={intent.projection}
            onChange={(projection) => onChange({ ...intent, projection })}
            options={[
              { value: 'first', label: t.intent.firstAngle },
              { value: 'third', label: t.intent.thirdAngle },
            ]}
          />
        </Field>

        <Field label={t.intent.lineStyle}>
          <Select<LineStyle>
            ariaLabel={t.intent.lineStyle}
            value={intent.lineStyle}
            onChange={(lineStyle) => onChange({ ...intent, lineStyle })}
            options={LINE_STYLES.map((s) => ({
              value: s,
              label: t.lineStyle[s],
              group: t.group[LINE_STYLE_GROUP[s]],
            }))}
          />
        </Field>
      </Section>

      <Section variant="block" title={t.intent.textSection}>
        <Field label={t.intent.textLanguage} hint={t.intent.textLanguageHint}>
          <Select<DrawingTextLanguage>
            ariaLabel={t.intent.textLanguage}
            value={intent.textLanguage}
            onChange={(textLanguage) => onChange({ ...intent, textLanguage })}
            options={DRAWING_TEXT_LANGUAGES.map((value) => ({ value, label: t.drawingLanguage[value] }))}
          />
        </Field>
      </Section>

      <Section variant="block" title={t.intent.extraSection}>
        <Field label={t.intent.notes}>
          <textarea
            className="textarea"
            value={intent.notes}
            placeholder={t.intent.notesPlaceholder}
            onChange={(e) => onChange({ ...intent, notes: e.target.value })}
          />
        </Field>
        <Field label={t.intent.exclude} hint={t.intent.excludeHint}>
          <input
            className="input"
            value={intent.exclude.join(', ')}
            placeholder={t.intent.excludePlaceholder}
            onChange={(e) =>
              onChange({
                ...intent,
                exclude: e.target.value
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
          />
        </Field>
      </Section>
    </>
  );
}
