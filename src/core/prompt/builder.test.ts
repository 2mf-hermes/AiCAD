import { describe, expect, it } from 'vitest';
import { createDefaultIntent } from '../types';
import { annotationBandHeight } from '../annotationOverlay';
import { sheetLayout } from '../sheetLayout';
import { buildInpaintPrompt, buildNegativePrompt, buildPositivePrompt, viewDirective } from './builder';

describe('technical drawing prompt text safeguards', () => {
  it('reserves supplied measurements for exact application overlays', () => {
    const intent = createDefaultIntent();
    intent.textLanguage = 'zh-Hant';
    intent.measurements = { '外徑': '120 mm' };
    const prompt = buildPositivePrompt(intent);
    expect(prompt).toContain('DO NOT rasterize');
    expect(prompt).toContain('application will render them exactly');
    expect(prompt).toContain('外徑: 120 mm');
  });

  it('reserves exact title-block text in application-overlay mode too', () => {
    const intent = createDefaultIntent();
    intent.text.renderMode = 'application';
    intent.text.title = 'Pump Assembly';
    intent.text.date = '2026-09-08';
    intent.text.customFields = [{ key: 'Drawing No.', value: 'A-101' }];
    const prompt = buildPositivePrompt(intent);
    expect(prompt).toContain('Do NOT rasterize titles');
    expect(prompt).toContain('title-block');
    expect(prompt).not.toContain('Title: Pump Assembly');
  });

  /* 圖面文字模式只剩兩種：應用程式精確疊加、生圖模型繪製。
     標題與比例尺一律由應用程式疊上，任何模式都不給模型畫，所以生圖模型模式
     裡也只有「不要把標題欄畫進圖面」這條路。 */
  it('never asks the image model to draw the title block or the scale bar, in any mode', () => {
    for (const renderMode of ['application', 'image-model'] as const) {
      const intent = createDefaultIntent();
      intent.text.renderMode = renderMode;
      intent.annotation.titleBlock = true;
      intent.annotation.scaleBar = true;
      intent.text.title = 'Pump Assembly';
      intent.text.date = '2026-09-08';
      intent.text.customFields = [{ key: 'Drawing No.', value: 'A-101' }];
      const prompt = buildPositivePrompt(intent);
      expect(prompt).toContain('Title slot: keep the rectangle at');
      expect(prompt).toContain('the application renders the ISO 7200 title-block frame');
      expect(prompt).toContain('the application draws the graphic scale bar there as its own overlay layer');
      expect(prompt).not.toContain('draw exactly one ISO 7200 title block');
      expect(prompt).not.toContain('Title: Pump Assembly');
      expect(prompt).not.toContain('Drawing No.: A-101');
      expect(buildNegativePrompt(intent)).toContain('title block');
    }
  });

  it('lets image-model mode letter the drawing area but not the title block', () => {
    const intent = createDefaultIntent();
    intent.text.renderMode = 'image-model';
    intent.measurements = { OD: '120 mm' };
    const prompt = buildPositivePrompt(intent);
    expect(prompt).toContain('Render the drawing-area labels');
    expect(prompt).toContain('Dimension values that must be rendered clearly and exactly');
    const negative = buildNegativePrompt(intent);
    expect(negative).not.toContain('any text');
    expect(negative).toContain('title block');
  });

  it('actively excludes common pseudo-text failures from image generation', () => {
    const negative = buildNegativePrompt(createDefaultIntent());
    expect(negative).toContain('garbled text');
    expect(negative).toContain('invented glyphs');
    expect(negative).toContain('warped lettering');
    expect(negative).toContain('misspelled labels');
  });

  it('applies the application-overlay strategy to inpainting', () => {
    const intent = createDefaultIntent();
    intent.textLanguage = 'zh-Hant';
    const prompt = buildInpaintPrompt(intent, { id: 'test-mask', x: 0, y: 0, w: 1, h: 1, instruction: 'add a label' });
    expect(prompt).toContain('Do NOT rasterize new titles');
    expect(prompt).toContain('application to render exact vector-like text overlays');
    expect(prompt).toContain('Never generate pseudo-text');
  });

  /* 使用者的要求：無論有沒有開標題，都要按標準圖面標題位置預留空白，不得把物件畫進去。 */
  it('keeps the standard title slot blank even when the title-block option is off', () => {
    const off = createDefaultIntent();
    off.annotation.titleBlock = false;
    off.text.renderMode = 'application';
    const withoutBlock = buildPositivePrompt(off);
    expect(withoutBlock).toContain('Title slot: keep the rectangle at');
    expect(withoutBlock).toContain('as completely blank paper');
    expect(withoutBlock).not.toContain('this sheet has no title block');
    expect(buildNegativePrompt(off)).toContain('title block');

    const on = createDefaultIntent();
    on.annotation.titleBlock = true;
    on.text.renderMode = 'application';
    const withBlock = buildPositivePrompt(on);
    expect(withBlock).toContain('Reserved band');
    expect(withBlock).toContain('The application draws the title block there as its own overlay layer');
  });

  it('supplements the six standard views only when the prompt names none', () => {
    const bare = createDefaultIntent();
    bare.subject = 'gearbox housing';
    bare.notes = '';
    expect(viewDirective(bare)).toContain('draw exactly six orthographic views');

    const stated = createDefaultIntent();
    stated.subject = 'gearbox housing';
    stated.notes = 'front view and section A-A only';
    const directive = viewDirective(stated);
    expect(directive).toContain('render only the viewpoints that the request itself states');
    expect(directive).not.toContain('draw exactly six orthographic views');
  });

  /* 「應用程式精確疊加」模式下，標註帶的位置必須真的送進提示詞：留白區與程式疊加區是同一條帶，
     否則模型把標註畫在圖上、程式又疊一次，同一標註會出現兩份。 */
  it('reserves the annotation band and places it directly above the footer', () => {
    const intent = createDefaultIntent();
    intent.text.renderMode = 'application';
    intent.measurements = { '\u5916\u5f91': '\u00d8120', '\u5b54\u8ddd': '85' };
    const prompt = buildPositivePrompt(intent);
    expect(prompt).toContain('Annotation band: keep the band at');

    const layout = sheetLayout({
      titleBlock: intent.annotation.titleBlock,
      measurements: true,
      scaleBar: intent.annotation.scaleBar,
      annotation: annotationBandHeight(intent),
    });
    expect(layout.annotation).not.toBeNull();
    const band = layout.annotation!;
    const footer = layout.footer!;
    /* 帶的上緣要剛好貼著頁尾上緣，下緣落在頁尾裡就是疊錯位置。 */
    expect(band.y + band.h).toBeCloseTo(footer.y, 6);
    expect(layout.drawing.y + layout.drawing.h).toBeLessThanOrEqual(band.y + 1e-9);
  });

  it('keeps the band out of image-model mode, where the model letters the drawing itself', () => {
    const intent = createDefaultIntent();
    intent.text.renderMode = 'image-model';
    intent.measurements = { '\u5916\u5f91': '\u00d8120' };
    expect(annotationBandHeight(intent)).toBe(0);
    const prompt = buildPositivePrompt(intent);
    expect(prompt).not.toContain('Annotation band: keep the band at');
  });
});
