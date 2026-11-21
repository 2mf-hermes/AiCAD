import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultSettings } from '../settings';
import { emptyEngineeringDocument } from './document';
import { generateEngineeringDocument, refineEngineeringPrompt } from './ai';
import type { GeometryClient } from './client';
const { generate } = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock('../providers/provider', () => ({ createProvider: () => ({ generate }) }));
function setup() {
  const settings = createDefaultSettings();
  settings.providers[0].enabled = true; settings.providers[0].textModel = 'cad-test';
  settings.activeTextProvider = settings.providers[0].id;
  const current = emptyEngineeringDocument('3d');
  const next = structuredClone(current);
  next.features = [{ id: 'base', name: 'Base', type: 'box', inputs: [], params: { width: 80, height: 40, depth: 12 } }];
  const request = vi.fn().mockResolvedValue({ bodies: [], volume: 1 });
  const abort = new AbortController();
  return { settings, current, next, request, abort, options: { settings, current, prompt: 'Create a box', references: [], client: { request } as unknown as GeometryClient, signal: abort.signal, onStatus: vi.fn() } };
}
beforeEach(() => generate.mockReset());
describe('engineering AI validation pipeline', () => {
  it('allows three repair rounds and validates before returning', async () => {
    const s = setup();
    generate.mockResolvedValueOnce('invalid').mockResolvedValueOnce('{}').mockResolvedValueOnce('[]').mockResolvedValue(JSON.stringify(s.next));
    const result = await generateEngineeringDocument(s.options);
    expect(generate).toHaveBeenCalledTimes(4); expect(s.request).toHaveBeenCalledTimes(1);
    expect(result.features[0].params.width).toBe(80);
  });
  it('stops after the third unsuccessful repair and preserves the input document', async () => {
    const s = setup(); generate.mockResolvedValue('invalid');
    await expect(generateEngineeringDocument(s.options)).rejects.toThrow('幾何驗證失敗');
    expect(generate).toHaveBeenCalledTimes(4); expect(s.current.features).toEqual([]);
    expect(s.request).not.toHaveBeenCalled();
  });
  it('rejects a cancelled response even if the provider ignores cancellation', async () => {
    const s = setup(); generate.mockImplementation(async () => { s.abort.abort(); return JSON.stringify(s.next); });
    await expect(generateEngineeringDocument(s.options)).rejects.toMatchObject({ name: 'AbortError' });
    expect(s.request).not.toHaveBeenCalled(); expect(generate).toHaveBeenCalledTimes(1);
  });
  it('rejects cancellation during geometry validation', async () => {
    const s = setup(); generate.mockResolvedValue(JSON.stringify(s.next));
    s.request.mockImplementation(async () => { s.abort.abort(); return {}; });
    await expect(generateEngineeringDocument(s.options)).rejects.toMatchObject({ name: 'AbortError' });
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it('repairs a real kernel failure before returning', async () => {
    const s = setup(); generate.mockResolvedValue(JSON.stringify(s.next));
    s.request.mockRejectedValueOnce(new Error('Invalid fillet radius'));
    await generateEngineeringDocument(s.options);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls[1][0].input.draft).toContain('Invalid fillet radius');
  });
  it('refinement preserves engineering settings in model context', async () => {
    const s = setup(); generate.mockResolvedValue('A refined box');
    expect(await refineEngineeringPrompt(s.settings, 'box', s.current, [], s.abort.signal)).toBe('A refined box');
    expect(generate.mock.calls[0][0].input.draft).toContain('AL6061-T6');
  });
});
