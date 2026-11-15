import type { DrawingIntent } from '../types';
import type { DraftSvg } from './draft';

/**
 * 草稿階段為什麼沒東西可顯示。
 * - no-text-model：精煉引擎設為「無」，整段本來就不跑。
 * - unparsed：模型有回話，但回覆裡沒有可用的幾何線稿（缺 <svg>、只有 HTML 版面、或被截斷）。
 * - error：文字模型呼叫本身失敗（逾時、401、額度…）。
 * 三種都要讓使用者看見，否則右欄空白就等於「跳過草稿」。
 */
export type DraftIssue = 'no-text-model' | 'unparsed' | 'error';

/** Successful text-stage output only; never stores provider settings or credentials. */
export interface PreparedGeneration {
  key: string;
  draft: DraftSvg | null;
  basePrompt: string;
  /** 這次文字階段是否真的跑過模型（精煉或擬稿）。false 代表沒有可用文字模型，整段被跳過。 */
  textModelUsed?: boolean;
  /** 沒有草稿時的原因；成功或有草稿時為 null。 */
  draftIssue?: DraftIssue | null;
}

/** Include reference contents, not just filenames, to prevent stale draft reuse. */
export function generationKey(intent: DrawingIntent, canvas: { width: number; height: number }): string {
  return JSON.stringify([intent, canvas.width, canvas.height]);
}

/** One entry per workspace, intentionally excluded from project persistence. */
export class DraftCache {
  private entry: PreparedGeneration | null = null;

  remember(value: PreparedGeneration): void {
    this.entry = structuredClone(value);
  }

  peek(key: string): PreparedGeneration | undefined {
    return this.entry?.key === key ? structuredClone(this.entry) : undefined;
  }

  forget(): void {
    this.entry = null;
  }
}
