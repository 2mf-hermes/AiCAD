/* 生成管線：草稿階段的接線與「壞掉也不中斷」的備援行為 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls: { mode: string; input: Record<string, unknown> }[] = [];
let textReply: () => Promise<unknown> = async () => '';
let imageReply: () => Promise<unknown> = async () => ({ base64: 'aW1n', width: 8, height: 8 });

vi.mock('../providers/provider', () => ({
  createProvider: () => ({
    generate: async (request: { mode: string; input: Record<string, unknown> }) => {
      calls.push(request);
      return request.mode === 'text' ? textReply() : imageReply();
    },
  }),
}));

/** 測試環境沒有 canvas：草稿藍圖一定點陣化失敗，正好用來驗證降級路徑。 */
let canvasAvailable = false;

vi.mock('./draft', async () => {
  const actual = await vi.importActual<typeof import('./draft')>('./draft');
  return {
    ...actual,
    renderDraftPng: async () => {
      if (!canvasAvailable) throw new Error('無法建立 2D 繪圖環境');
      // 這裡不需要真的畫圖：要驗證的是「有沒有把藍圖交給生圖模型」。
      return { mimeType: 'image/png', base64: 'ZHJhZnQ=' };
    },
  };
});

const { generate } = await import('./orchestrator');
const { createDefaultSettings } = await import('../settings');
const { createDefaultConfig } = await import('../providers/registry');

const SVG_REPLY = '<svg viewBox="0 0 1000 700"><line x1="40" y1="40" x2="900" y2="40"/></svg>';

function settingsFor(options: { text?: boolean; inpaint?: boolean } = {}) {
  const settings = createDefaultSettings();
  const provider = createDefaultConfig('openai', 'primary');
  provider.name = 'Primary';
  provider.enabled = true;
  provider.capabilities.text = options.text ?? true;
  provider.capabilities.imageGenerate = true;
  provider.capabilities.imageInpaint = options.inpaint ?? false;
  settings.providers = [provider];
  settings.activeTextProvider = provider.id;
  settings.activeImageProvider = provider.id;
  return settings;
}

const intent = () =>
  ({
    kind: 'mechanical-part',
    subject: 'bracket',
    categoryContent: '',
    notes: '',
    lineStyle: 'technical-ink',
    textLanguage: 'en',
    annotation: { dimensions: true, unit: 'mm', projection: 'first', tolerance: false },
    text: { renderMode: 'app-overlay', title: '', date: '', customFields: [] },
    measurements: {},
    projection: 'first',
    exclude: [],
    references: [],
  }) as never;

const deps = (settings: ReturnType<typeof settingsFor>) => ({
  settings,
  signal: new AbortController().signal,
  onProgress: vi.fn(),
});

describe('draft → svg → image 管線', () => {
  beforeEach(() => {
    calls.length = 0;
    canvasAvailable = false;
    textReply = async () => SVG_REPLY;
    imageReply = async () => ({ base64: 'aW1n', width: 8, height: 8 });
  });

  it('先擬草稿再出圖，送給生圖模型的提示詞帶著草稿版面依據', async () => {
    const board = await generate(intent(), deps(settingsFor()));
    expect(calls.map((c) => c.mode)).toEqual(['text', 'image']);
    const prompt = String(calls[1].input.prompt);
    expect(prompt).toContain('construction draft');
    expect(board.resolvedPrompt).toBe(prompt);
  });

  it('草稿階段用 SVG 指令，不沿用精煉用的幾何描述指令', async () => {
    await generate(intent(), deps(settingsFor()));
    const systemPrompt = String(calls[0].input.systemPrompt);
    expect(systemPrompt).toMatch(/<svg>/);
    expect(systemPrompt).not.toContain('one concise geometry paragraph');
  });

  it('草稿失敗時仍保留原本的文字精煉階段', async () => {
    textReply = async () => 'not svg';
    await generate(intent(), deps(settingsFor()));
    expect(calls.map((c) => c.mode)).toEqual(['text', 'text', 'image']);
  });

  it('文字模型回傳非 SVG 時仍完成生成，只是沒有草稿', async () => {
    textReply = async () => 'I cannot help with that.';
    const board = await generate(intent(), deps(settingsFor()));
    expect(calls.map((c) => c.mode)).toEqual(['text', 'text', 'image']);
    expect(board.resolvedPrompt).not.toContain('construction draft');
  });

  it('草稿階段拋錯時不讓整次生成失敗', async () => {
    textReply = async () => { throw new Error('504 upstream'); };
    const board = await generate(intent(), deps(settingsFor()));
    expect(board.imageRef).toContain('data:image/png;base64,');
    expect(calls.at(-1)?.mode).toBe('image');
  });

  it('藍圖無法點陣化時退回文字版草稿指示，而不是硬送不存在的附圖', async () => {
    await generate(intent(), deps(settingsFor({ inpaint: true })));
    const input = calls.at(-1)?.input ?? {};
    expect(String(input.prompt)).toContain('draft summary');
    expect(String(input.prompt)).not.toContain('first attached image');
    expect(input.images).toBeUndefined();
  });

  it('沒有局部重繪能力的引擎不附草稿圖，避免被迫走 /images/edits', async () => {
    canvasAvailable = true;
    await generate(intent(), deps(settingsFor({ inpaint: false })));
    const input = calls.at(-1)?.input ?? {};
    const images = input.images as { base64: string }[] | undefined;
    // 使用者沒有參考圖，且引擎沒能力接收輸入影像 → 不該附上任何圖
    expect(images).toBeUndefined();
    expect(String(input.prompt)).toContain('draft summary');
  });

  it('有局部重繪能力時把草稿藍圖排在第一張附圖', async () => {
    canvasAvailable = true;
    await generate(intent(), deps(settingsFor({ inpaint: true })));
    const input = calls.at(-1)?.input ?? {};
    const images = input.images as { mimeType: string }[];
    expect(images?.[0]?.mimeType).toBe('image/png');
    expect(String(input.prompt)).toContain('first attached image');
  });

  it('未接文字模型時完全不呼叫草稿階段', async () => {
    const settings = settingsFor();
    settings.activeTextProvider = 'none';
    await generate(intent(), deps(settings));
    expect(calls.map((c) => c.mode)).toEqual(['image']);
  });

  it('草稿階段回報獨立的進度階段，讓介面能顯示正在擬稿', async () => {
    const runDeps = deps(settingsFor());
    await generate(intent(), runDeps);
    const stages = runDeps.onProgress.mock.calls.map((call) => (call[0] as { stage: string }).stage);
    expect(stages).toContain('drafting');
    expect(stages).toContain('drawing');
  });
});
