/* 生成管線：草稿（SVG＋HTML）→ 判讀改寫提示詞 → 純生成端點 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls: { mode: string; input: Record<string, unknown> }[] = [];
/** 文字階段有兩種：擬草稿、判讀改寫。用系統指令分辨，讓每個測試各給一種回應。 */
let textReply: (input: Record<string, unknown>) => Promise<unknown> = async () => '';
let imageReply: () => Promise<unknown> = async () => ({ base64: 'aW1n', width: 8, height: 8 });

vi.mock('../providers/provider', () => ({
  createProvider: () => ({
    generate: async (request: { mode: string; input: Record<string, unknown> }) => {
      calls.push(request);
      return request.mode === 'text' ? textReply(request.input) : imageReply();
    },
  }),
}));

/** 測試環境沒有 canvas：草稿檢視圖一定點陣化失敗，正好驗證只送 HTML 的路徑。 */
let canvasAvailable = false;

vi.mock('./draft', async () => {
  const actual = await vi.importActual<typeof import('./draft')>('./draft');
  return {
    ...actual,
    renderDraftPng: async () => {
      if (!canvasAvailable) throw new Error('無法建立 2D 繪圖環境');
      // 這裡不需要真的畫圖：要驗證的是「有沒有把草稿交給判讀模型」。
      return { mimeType: 'image/png', base64: 'ZHJhZnQ=' };
    },
  };
});

const { generate } = await import('./orchestrator');
const { createDefaultSettings } = await import('../settings');
const { createDefaultConfig } = await import('../providers/registry');

const SVG_REPLY = '<svg viewBox="0 0 1000 700"><line x1="40" y1="40" x2="900" y2="40"/></svg>';
const PROMPT_TEXT = 'A single mechanical bracket on a landscape sheet, front view centred with a top view above it.';

/** 擬草稿的回合回草稿，判讀改寫的回合回提示詞。 */
const draftThenPrompt = (prompt = PROMPT_TEXT): ((input: Record<string, unknown>) => Promise<unknown>) =>
  async (input) => (String(input.systemPrompt ?? '').includes('art director') ? prompt : SVG_REPLY);

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
    text: { renderMode: 'application', title: '', date: '', customFields: [] },
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

const imageCalls = () => calls.filter((c) => c.mode === 'image');
const translateCall = () => calls.filter((c) => c.mode === 'text').at(-1);

describe('草稿 → HTML/SVG → 提示詞 → 純生成', () => {
  beforeEach(() => {
    calls.length = 0;
    canvasAvailable = false;
    textReply = draftThenPrompt();
    imageReply = async () => ({ base64: 'aW1n', width: 8, height: 8 });
  });

  it('先擬草稿、再判讀改寫，最後才用改寫後的提示詞生圖', async () => {
    const board = await generate(intent(), deps(settingsFor()));
    expect(calls.map((c) => c.mode)).toEqual(['text', 'text', 'image']);
    const prompt = String(imageCalls()[0].input.prompt);
    expect(prompt).toContain('mechanical bracket');
    expect(board.resolvedPrompt).toBe(prompt);
  });

  it('草稿圖不再當附圖送出，即使引擎具備局部重繪能力', async () => {
    canvasAvailable = true;
    await generate(intent(), deps(settingsFor({ inpaint: true })));
    expect(imageCalls()[0].input.images).toBeUndefined();
  });

  it('使用者自己的參考圖仍然照送', async () => {
    canvasAvailable = true;
    const withReference = { ...(intent() as object), references: [
      { name: 'reference.png', mimeType: 'image/png', dataUrl: 'data:image/png;base64,cmVm' },
    ] } as never;
    await generate(withReference, deps(settingsFor()));
    const images = imageCalls()[0].input.images as { base64: string }[];
    expect(images).toHaveLength(1);
    expect(images[0].base64).toBe('cmVm');
  });

  it('判讀階段拿到 HTML 原始碼與草稿檢視圖', async () => {
    canvasAvailable = true;
    await generate(intent(), deps(settingsFor()));
    const input = translateCall()?.input ?? {};
    expect(String(input.subject)).toContain('Draft HTML:');
    expect(String(input.subject)).toContain('<svg');
    expect((input.images as unknown[]).length).toBe(1);
  });

  it('草稿的 HTML 版本與改寫後的提示詞一起被保存', async () => {
    const onPrepared = vi.fn();
    await generate(intent(), { ...deps(settingsFor()), onPrepared });
    const prepared = onPrepared.mock.calls[0][0];
    expect(String(prepared.draft.html)).toContain('<!doctype html>');
    expect(String(prepared.draft.html)).toContain('<svg');
    expect(String(prepared.draft.finalPrompt)).toContain('mechanical bracket');
  });

  it('模型附上 HTML 版本時直接採用該份，不再由程式代寫', async () => {
    textReply = async (input) => (String(input.systemPrompt ?? '').includes('art director')
      ? PROMPT_TEXT
      : `${SVG_REPLY}\n\`\`\`html\n<!doctype html><html><body><figure>${SVG_REPLY}<figcaption>FRONT</figcaption></figure></body></html>\n\`\`\``);
    await generate(intent(), deps(settingsFor()));
    const subject = String(translateCall()?.input.subject ?? '');
    expect(subject).toContain('figcaption');
    expect(subject).not.toContain('Ai Cad construction draft');
  });

  it('判讀失敗時退回草稿幾何摘要，仍然生圖', async () => {
    textReply = async (input) => (String(input.systemPrompt ?? '').includes('art director')
      ? `<svg viewBox="0 0 1000 700">${SVG_REPLY}</svg>`
      : SVG_REPLY);
    const board = await generate(intent(), deps(settingsFor()));
    expect(board.imageRef).toContain('data:image/png;base64,');
    const prompt = String(imageCalls()[0].input.prompt);
    expect(prompt).toContain('A construction draft was prepared for this sheet');
    expect(prompt).not.toContain('mechanical bracket on a landscape sheet');
  });

  it('判讀階段拋錯不讓整次生成失敗', async () => {
    textReply = async (input) => {
      if (String(input.systemPrompt ?? '').includes('art director')) throw new Error('504 upstream');
      return SVG_REPLY;
    };
    const board = await generate(intent(), deps(settingsFor()));
    expect(board.imageRef).toContain('data:image/png;base64,');
    expect(calls.at(-1)?.mode).toBe('image');
  });

  it('草稿文字標示存進圖面供補回，但不進入生圖提示詞', async () => {
    textReply = async (input) => (String(input.systemPrompt ?? '').includes('art director')
      ? PROMPT_TEXT
      : '<svg viewBox="0 0 1000 700"><line x1="40" y1="40" x2="900" y2="40"/><text x="500" y="70" text-anchor="middle">FRONT VIEW</text></svg>');
    const board = await generate(intent(), deps(settingsFor()));
    expect(board.textLabels).toHaveLength(1);
    expect(board.textLabels?.[0]).toMatchObject({ text: 'FRONT VIEW', anchor: 'middle' });
    const input = imageCalls()[0].input;
    expect(String(input.prompt)).not.toContain('FRONT VIEW');
    // 改寫後的提示詞也要保留「不准畫字」的告誡。
    expect(String(input.prompt)).toContain('Draw NO text at all');
    expect(String(input.negativePrompt)).toContain('letters');
  });

  it('交給生圖模型畫字時不保存標示，避免文字重複', async () => {
    textReply = async (input) => (String(input.systemPrompt ?? '').includes('art director')
      ? PROMPT_TEXT
      : '<svg><line x1="40" y1="40" x2="900" y2="40"/><text x="5" y="5">A</text></svg>');
    const imageText = { ...(intent() as Record<string, unknown>), text: { renderMode: 'image-model', title: '', date: '', customFields: [] } } as never;
    const board = await generate(imageText, deps(settingsFor()));
    expect(board.textLabels).toBeUndefined();
  });

  it('草稿階段用 SVG 指令，不沿用精煉用的幾何描述指令', async () => {
    await generate(intent(), deps(settingsFor()));
    const systemPrompt = String(calls[0].input.systemPrompt);
    expect(systemPrompt).toMatch(/<svg>/);
    expect(systemPrompt).toContain('```html');
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

  it('檢視圖點陣化失敗時只送 HTML 原始碼，不硬送不存在的附圖', async () => {
    canvasAvailable = false;
    await generate(intent(), deps(settingsFor({ inpaint: true })));
    const input = translateCall()?.input ?? {};
    expect(input.images).toBeUndefined();
    expect(String(input.subject)).toContain('No render could be attached');
    expect(imageCalls()[0].input.images).toBeUndefined();
  });

  it('未接文字模型時完全呼叫不到草稿與判讀階段', async () => {
    const settings = settingsFor();
    settings.activeTextProvider = 'none';
    await generate(intent(), deps(settings));
    expect(calls.map((c) => c.mode)).toEqual(['image']);
  });

  it('沿用上次草稿時不再問模型，直接用存下來的提示詞', async () => {
    const settings = settingsFor();
    const prepared = {
      key: JSON.stringify([intent(), settings.canvas.width, settings.canvas.height]),
      draft: {
        svg: SVG_REPLY,
        html: '<!doctype html><html><body>cached</body></html>',
        summary: 'cached summary',
        labels: [],
        finalPrompt: 'CACHED PROMPT for the bracket sheet.',
      },
      basePrompt: 'cached base prompt',
    };
    await generate(intent(), deps(settings), { reuse: prepared });
    expect(calls.map((c) => c.mode)).toEqual(['image']);
    expect(String(imageCalls()[0].input.prompt)).toContain('CACHED PROMPT');
  });

  it('草稿階段回報獨立的進度階段，讓介面能顯示正在擬稿', async () => {
    const runDeps = deps(settingsFor());
    await generate(intent(), runDeps);
    const stages = runDeps.onProgress.mock.calls.map((call) => (call[0] as { stage: string }).stage);
    expect(stages).toContain('drafting');
    expect(stages).toContain('drawing');
  });
});
