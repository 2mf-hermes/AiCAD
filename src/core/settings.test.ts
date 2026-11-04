import { describe, expect, it } from 'vitest';
import { createDefaultSettings, normalizeSettings } from './settings';

describe('settings migration', () => {
  it('migrates v2 keyed providers while preserving ids and secret references', () => {
    const migrated = normalizeSettings({ version: 2, providers: {
      openai: { enabled: true, label: 'Primary', baseUrl: 'https://relay.example/v1', timeoutSec: 30 },
    }, activeImageProvider: 'openai' });
    const provider = migrated.providers.find((item) => item.id === 'openai');
    expect(migrated.version).toBe(3);
    expect(provider).toMatchObject({ name: 'Primary', enabled: true, timeout: 30, secretRef: 'aicad.secret.openai' });
  });

  it('keeps text and image models isolated when both are configured', () => {
    const defaults = createDefaultSettings();
    const provider = { ...defaults.providers[0], textModel: 'text-only-model', imageModel: 'image-only-model', model: '' };
    const normalized = normalizeSettings({ providers: [provider] }, defaults);
    expect(normalized.providers[0].textModel).toBe('text-only-model');
    expect(normalized.providers[0].imageModel).toBe('image-only-model');
  });

  it('migrates a legacy shared model into both role-specific model fields', () => {
    const defaults = createDefaultSettings();
    const provider = { ...defaults.providers[0], textModel: undefined, imageModel: undefined, model: 'legacy-shared-model' };
    const normalized = normalizeSettings({ providers: [provider] }, defaults);
    expect(normalized.providers[0].textModel).toBe('legacy-shared-model');
    expect(normalized.providers[0].imageModel).toBe('legacy-shared-model');
  });

  it('restores defaults when a v3 provider array is empty', () => {
    const normalized = normalizeSettings({ version: 3, providers: [] }, createDefaultSettings());
    expect(normalized.providers.length).toBeGreaterThan(0);
  });

  it('defaults legacy providers into both fallback chains and preserves explicit choices', () => {
    const defaults = createDefaultSettings();
    const { fallbackEnabled: _fallbackEnabled, textFallbackEnabled: _textFallbackEnabled, imageFallbackEnabled: _imageFallbackEnabled, ...legacy } = defaults.providers[0];
    const migrated = normalizeSettings({ providers: [legacy] }, defaults);
    expect(migrated.providers[0]).toMatchObject({ fallbackEnabled: true, textFallbackEnabled: true, imageFallbackEnabled: true });

    const explicit = normalizeSettings({ providers: [{ ...defaults.providers[0], fallbackEnabled: true, textFallbackEnabled: false, imageFallbackEnabled: true }] }, defaults);
    expect(explicit.providers[0]).toMatchObject({ fallbackEnabled: true, textFallbackEnabled: false, imageFallbackEnabled: true });
  });

  it('drops duplicate instance ids and keeps the first instance', () => {
    const defaults = createDefaultSettings();
    const first = { ...defaults.providers[0], id: 'duplicate', name: 'First' };
    const second = { ...defaults.providers[1], id: 'duplicate', name: 'Second' };
    const normalized = normalizeSettings({ providers: [first, second] }, defaults);
    expect(normalized.providers.filter((item) => item.id === 'duplicate')).toHaveLength(1);
    expect(normalized.providers[0].name).toBe('First');
  });
});
