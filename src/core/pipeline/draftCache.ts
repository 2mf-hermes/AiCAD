import type { DrawingIntent } from '../types';
import type { DraftSvg } from './draft';

/** Successful text-stage output only; never stores provider settings or credentials. */
export interface PreparedGeneration {
  key: string;
  draft: DraftSvg | null;
  basePrompt: string;
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
