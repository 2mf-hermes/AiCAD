import { afterEach, describe, expect, it, vi } from 'vitest';
import { setTransport, type HttpRequest } from '../net/transport';
import { createDefaultConfig } from './registry';
import { createOpenAICompatibleAdapter } from './openaiCompatible';

const spec = {
  id: 'openai' as const,
  displayName: 'OpenAI',
  baseUrl: 'https://api.openai.com',
  apiPrefix: '/v1',
  textModel: 'gpt-4.1-mini',
  imageModel: 'gpt-image-1',
  capabilities: { text: true, imageGenerate: true, imageInpaint: true, vision: true },
  isLocal: false,
};

describe('OpenAI-compatible inpainting', () => {
  afterEach(() => {
    setTransport(async () => ({ status: 500, ok: false, text: 'transport not configured' }));
  });

  it('sends image edits as multipart and returns b64_json', async () => {
    const putImageData = vi.fn();
    vi.stubGlobal('Image', class {
      src = '';
      naturalWidth = 2;
      naturalHeight = 1;
      async decode() {}
    });
    vi.stubGlobal('document', { createElement: () => ({
      width: 0, height: 0,
      getContext: () => ({
        drawImage: vi.fn(),
        getImageData: () => ({ data: new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]) }),
        putImageData,
      }),
      toDataURL: () => 'data:image/png;base64,openai-alpha-mask',
    }) });
    let captured: HttpRequest | undefined;
    setTransport(async (request) => {
      captured = request;
      return { status: 200, ok: true, text: JSON.stringify({ data: [{ b64_json: 'edited-image' }] }) };
    });
    const config = createDefaultConfig('openai', 'cloud');
    config.baseUrl = 'https://relay.example/v1';
    config.imageModel = 'gpt-image-1';
    config.timeoutSec = 321;
    const adapter = createOpenAICompatibleAdapter(spec);

    const result = await adapter.inpaintImage!(config, 'secret', {
      prompt: 'replace bearing', imageBase64: 'source-png', maskBase64: 'mask-png',
      width: 1024, height: 1024, seed: 42,
    }, new AbortController().signal);

    expect(result).toEqual({ base64: 'edited-image', width: 1024, height: 1024, seed: 42 });
    expect(captured).toMatchObject({
      url: 'https://relay.example/v1/images/edits', method: 'POST', timeoutMs: 321000,
      headers: { Authorization: 'Bearer secret' },
    });
    expect(captured?.json).toBeUndefined();
    expect(captured?.multipart).toEqual(expect.arrayContaining([
      { name: 'image', filename: 'image.png', contentType: 'image/png', base64: 'source-png' },
      { name: 'mask', filename: 'mask.png', contentType: 'image/png', base64: 'openai-alpha-mask' },
      { name: 'prompt', value: 'replace bearing' },
      { name: 'model', value: 'gpt-image-1' },
      { name: 'size', value: 'auto' },
      { name: 'response_format', value: 'b64_json' },
    ]));
    const converted = putImageData.mock.calls[0][0].data as Uint8ClampedArray;
    expect(Array.from(converted)).toEqual([0, 0, 0, 255, 0, 0, 0, 0]);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('honors custom endpoint templates and query authentication', async () => {
    vi.stubGlobal('Image', class { src = ''; naturalWidth = 1; naturalHeight = 1; async decode() {} });
    vi.stubGlobal('document', { createElement: () => ({
      width: 0, height: 0,
      getContext: () => ({ drawImage: vi.fn(), getImageData: () => ({ data: new Uint8ClampedArray([255, 255, 255, 255]) }), putImageData: vi.fn() }),
      toDataURL: () => 'data:image/png;base64,alpha-mask',
    }) });
    let captured: HttpRequest | undefined;
    setTransport(async (request) => {
      captured = request;
      return { status: 200, ok: true, text: JSON.stringify({ data: [{ b64_json: 'ok' }] }) };
    });
    const config = createDefaultConfig('openai', 'relay');
    config.baseUrl = 'https://relay.example/api';
    config.endpoint = '/proxy/{operation}';
    config.authentication = { type: 'query', headerName: '', queryName: 'token', prefix: 'key-' };

    await createOpenAICompatibleAdapter(spec).inpaintImage!(config, 'secret', {
      prompt: 'edit', imageBase64: 'source', maskBase64: 'mask', width: 256, height: 256,
    }, new AbortController().signal);

    expect(captured?.url).toBe('https://relay.example/api/proxy/images/edits?token=key-secret');
    expect(captured?.headers).not.toHaveProperty('authorization');
    vi.unstubAllGlobals();
  });

  it('routes text, image and inpaint calls to their own endpoint paths', async () => {
    vi.stubGlobal('Image', class { src = ''; naturalWidth = 1; naturalHeight = 1; async decode() {} });
    vi.stubGlobal('document', { createElement: () => ({
      width: 0, height: 0,
      getContext: () => ({ drawImage: vi.fn(), getImageData: () => ({ data: new Uint8ClampedArray([255, 255, 255, 255]) }), putImageData: vi.fn() }),
      toDataURL: () => 'data:image/png;base64,alpha-mask',
    }) });
    const urls: string[] = [];
    setTransport(async (request) => {
      urls.push(request.url);
      const text = request.url.includes('/text')
        ? JSON.stringify({ choices: [{ message: { content: 'refined' } }] })
        : JSON.stringify({ data: [{ b64_json: 'ok' }] });
      return { status: 200, ok: true, text };
    });
    const config = createDefaultConfig('openai', 'cloud');
    config.baseUrl = 'https://relay.example/v1';
    config.authentication = { type: 'none', headerName: '', queryName: '', prefix: '' };
    config.textEndpoint = 'https://text.example/v1/chat/completions';
    config.imageEndpoint = 'https://image.example/v1/images/generations';
    config.inpaintEndpoint = 'https://inpaint.example/v1/images/edits';
    const adapter = createOpenAICompatibleAdapter(spec);
    const signal = new AbortController().signal;

    await adapter.refinePrompt!(config, 'secret', { draft: 'draft', subject: 'flange' }, signal);
    await adapter.generateImage!(config, 'secret', { prompt: 'draw', width: 64, height: 64 }, signal);
    await adapter.inpaintImage!(config, 'secret', {
      prompt: 'edit', imageBase64: 'source', maskBase64: 'mask', width: 64, height: 64,
    }, signal);

    expect(urls).toEqual([
      'https://text.example/v1/chat/completions',
      'https://image.example/v1/images/generations',
      'https://inpaint.example/v1/images/edits',
    ]);
    vi.unstubAllGlobals();
  });

  it('falls back to the generic endpoint when a per-type path is unset', async () => {
    vi.stubGlobal('Image', class { src = ''; naturalWidth = 1; naturalHeight = 1; async decode() {} });
    vi.stubGlobal('document', { createElement: () => ({
      width: 0, height: 0,
      getContext: () => ({ drawImage: vi.fn(), getImageData: () => ({ data: new Uint8ClampedArray([255, 255, 255, 255]) }), putImageData: vi.fn() }),
      toDataURL: () => 'data:image/png;base64,alpha-mask',
    }) });
    const urls: string[] = [];
    setTransport(async (request) => {
      urls.push(request.url);
      return { status: 200, ok: true, text: JSON.stringify({ data: [{ b64_json: 'ok' }] }) };
    });
    // 舊設定只有通用 endpoint：三個既有欄位留空時必須沿用同一條路徑。
    const config = createDefaultConfig('openai', 'cloud');
    config.baseUrl = 'https://relay.example/api';
    config.endpoint = '/proxy/{operation}';
    config.textEndpoint = '';
    config.imageEndpoint = '';
    config.inpaintEndpoint = '';
    const adapter = createOpenAICompatibleAdapter(spec);
    const signal = new AbortController().signal;

    await adapter.generateImage!(config, 'secret', { prompt: 'draw', width: 64, height: 64 }, signal);
    await adapter.inpaintImage!(config, 'secret', {
      prompt: 'edit', imageBase64: 'source', maskBase64: 'mask', width: 64, height: 64,
    }, signal);

    expect(urls).toEqual([
      'https://relay.example/api/proxy/images/generations',
      'https://relay.example/api/proxy/images/edits',
    ]);
    vi.unstubAllGlobals();
  });

  it('appends the API version path only when the base URL has none', async () => {
    const urls: string[] = [];
    setTransport(async (request) => {
      urls.push(request.url);
      return { status: 200, ok: true, text: JSON.stringify({ data: [{ b64_json: 'ok' }] }) };
    });
    const adapter = createOpenAICompatibleAdapter(spec);
    const signal = new AbortController().signal;

    // 只填服務位址：程式應自動補 /v1
    const hostOnly = createDefaultConfig('openai', 'cloud');
    hostOnly.baseUrl = 'https://api.openai.com';
    hostOnly.imageEndpoint = '';
    hostOnly.inpaintEndpoint = '';
    hostOnly.textEndpoint = '';
    hostOnly.endpoint = '';
    // 模型列表（獲取模型）走同一條補齊規則
    expect(adapter.apiBase!(hostOnly)).toBe('https://api.openai.com/v1');
    await adapter.generateImage!(hostOnly, 'secret', { prompt: 'draw', width: 64, height: 64 }, signal);
    // 使用者自己帶了路徑：以他填的為準，不重複補成 /v1/v1
    const selfPathed = createDefaultConfig('openai', 'cloud');
    selfPathed.baseUrl = 'https://api.openai.com/v1';
    selfPathed.imageEndpoint = '';
    selfPathed.inpaintEndpoint = '';
    selfPathed.textEndpoint = '';
    selfPathed.endpoint = '';
    await adapter.generateImage!(selfPathed, 'secret', { prompt: 'draw', width: 64, height: 64 }, signal);

    expect(urls).toEqual([
      'https://api.openai.com/v1/images/generations',
      'https://api.openai.com/v1/images/generations',
    ]);
  });
});
