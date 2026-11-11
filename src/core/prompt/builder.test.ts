import { describe, expect, it } from 'vitest';
import { createDefaultIntent } from '../types';
import { buildInpaintPrompt, buildNegativePrompt, buildPositivePrompt } from './builder';

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

  it('reserves exact title-block text in text-model-overlay mode too', () => {
    const intent = createDefaultIntent();
    intent.text.renderMode = 'text-model-overlay';
    intent.text.title = 'Pump Assembly';
    intent.text.date = '2026-09-08';
    intent.text.customFields = [{ key: 'Drawing No.', value: 'A-101' }];
    const prompt = buildPositivePrompt(intent);
    expect(prompt).toContain('Do NOT rasterize titles');
    expect(prompt).toContain('blank title-block geometry');
    expect(prompt).not.toContain('Title: Pump Assembly');
  });

  it('allows direct raster text only in image-model mode', () => {
    const intent = createDefaultIntent();
    intent.text.renderMode = 'image-model';
    intent.text.title = 'Pump Assembly';
    intent.text.date = '2026-09-08';
    intent.text.customFields = [{ key: 'Drawing No.', value: 'A-101' }];
    intent.measurements = { OD: '120 mm' };
    const prompt = buildPositivePrompt(intent);
    expect(prompt).toContain('Render all requested technical titles');
    expect(prompt).toContain('Title: Pump Assembly');
    expect(prompt).toContain('Drawing No.: A-101');
    expect(prompt).toContain('Dimension values that must be rendered clearly and exactly');
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

  it('reserves a blank title-block band only when the annotation option is on', () => {
    const on = createDefaultIntent();
    on.annotation.titleBlock = true;
    on.text.renderMode = 'text-model-overlay';
    const withBlock = buildPositivePrompt(on);
    expect(withBlock).toContain('Reserved band');
    expect(withBlock).toContain('blank title-block geometry');
    expect(withBlock).toContain('Title block: the application draws');

    const off = createDefaultIntent();
    off.annotation.titleBlock = false;
    off.text.renderMode = 'text-model-overlay';
    const withoutBlock = buildPositivePrompt(off);
    expect(withoutBlock).toContain('this sheet has no title block');
    expect(withoutBlock).not.toContain('blank title-block geometry');
    expect(buildNegativePrompt(off)).toContain('title block');
  });

  it('lets image-model mode draw one title block without contradicting the negative prompt', () => {
    const intent = createDefaultIntent();
    intent.annotation.titleBlock = true;
    intent.text.renderMode = 'image-model';
    expect(buildPositivePrompt(intent)).toContain('draw exactly one ISO 7200 title block');
    expect(buildNegativePrompt(intent)).not.toContain('title block');
  });
});
