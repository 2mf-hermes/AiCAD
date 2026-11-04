import { describe, expect, it } from 'vitest';
import { createDefaultSettings } from './settings';
import { resolveRunTimeoutSec } from './runTimeout';

describe('resolveRunTimeoutSec', () => {
  it('honours a configured timeout below the former hard-coded 90 second floor', () => {
    const settings = createDefaultSettings();
    const image = settings.providers.find((provider) => provider.id === settings.activeImageProvider)!;
    image.enabled = true;
    image.timeout = 12;

    expect(resolveRunTimeoutSec(settings, 'generate')).toBe(12);
  });

  it('includes text refinement only for generation and keeps the supported lower bound', () => {
    const settings = createDefaultSettings();
    const image = settings.providers.find((provider) => provider.id === settings.activeImageProvider)!;
    const text = settings.providers.find((provider) => provider.capabilities.text && provider.id !== image.id)!;
    image.enabled = true;
    image.timeout = 3;
    text.enabled = true;
    text.timeout = 45;
    settings.activeTextProvider = text.id;

    expect(resolveRunTimeoutSec(settings, 'generate')).toBe(45);
    expect(resolveRunTimeoutSec(settings, 'inpaint')).toBe(5);
  });
});
