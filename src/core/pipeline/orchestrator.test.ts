import { describe, expect, it, vi } from 'vitest';
import { createDefaultConfig } from '../providers/registry';
import { ProviderError } from '../providers/types';
import { executeWithFallback, ProviderFallbackError } from './orchestrator';

const config = (id: string, priority: number, retries = 0) => {
  const value = createDefaultConfig('openai', id);
  value.name = id; value.enabled = true; value.priority = priority; value.retryCount = retries;
  value.capabilities.imageGenerate = true;
  return value;
};
const noWait = async () => undefined;

describe('executeWithFallback', () => {
  it('sorts by priority and falls back once the first provider is exhausted', async () => {
    const calls: string[] = [];
    const result = await executeWithFallback([config('second', 2), config('first', 1)], 'image', async (item) => {
      calls.push(item.id);
      if (item.id === 'first') throw new ProviderError('server', item.id, 503);
      return 'ok';
    }, new AbortController().signal, undefined, noWait);
    expect(calls).toEqual(['first', 'second']);
    expect(result.config.id).toBe('second');
  });

  it.each([
    [429, 'rate-limit'], [503, 'server'], [undefined, 'timeout'], [undefined, 'network'],
  ] as const)('retries recoverable error %s', async (status, message) => {
    const run = vi.fn().mockRejectedValueOnce(new ProviderError(message, 'one', status)).mockResolvedValue('ok');
    await expect(executeWithFallback([config('one', 1, 1)], 'image', run, new AbortController().signal, undefined, noWait))
      .resolves.toMatchObject({ result: 'ok' });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('does not retry a 401 configuration error', async () => {
    const run = vi.fn().mockRejectedValue(new ProviderError('Invalid API Key', 'one', 401));
    await expect(executeWithFallback([config('one', 1, 5)], 'image', run, new AbortController().signal, undefined, noWait))
      .rejects.toBeInstanceOf(ProviderFallbackError);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('stops the entire chain when cancelled', async () => {
    const run = vi.fn().mockRejectedValue(new ProviderError('Cancelled', 'one', undefined, undefined, 'cancelled'));
    await expect(executeWithFallback([config('one', 1), config('two', 2)], 'image', run, new AbortController().signal, undefined, noWait))
      .rejects.toMatchObject({ kind: 'cancelled' });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('falls back immediately on invalid response', async () => {
    const run = vi.fn().mockImplementation(async (item) => {
      if (item.id === 'one') throw new ProviderError('invalid response', item.id, undefined, undefined, 'invalid-response');
      return 'ok';
    });
    await expect(executeWithFallback([config('one', 1, 5), config('two', 2)], 'image', run, new AbortController().signal, undefined, noWait))
      .resolves.toMatchObject({ result: 'ok', config: { id: 'two' } });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('skips providers excluded from the image fallback chain', async () => {
    const first = config('one', 1);
    const second = config('two', 2);
    second.imageFallbackEnabled = false;
    const run = vi.fn().mockRejectedValue(new ProviderError('server', 'one', 503));
    await expect(executeWithFallback([first, second], 'image', run, new AbortController().signal, undefined, noWait))
      .rejects.toBeInstanceOf(ProviderFallbackError);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('allows text fallback independently from image fallback', async () => {
    const first = config('one', 1);
    const second = config('two', 2);
    second.imageFallbackEnabled = false;
    second.textFallbackEnabled = true;
    const run = vi.fn().mockImplementation(async (item) => {
      if (item.id === 'one') throw new ProviderError('server', item.id, 503);
      return 'ok';
    });
    await expect(executeWithFallback([first, second], 'text', run, new AbortController().signal, undefined, noWait))
      .resolves.toMatchObject({ result: 'ok', config: { id: 'two' } });
  });
});
