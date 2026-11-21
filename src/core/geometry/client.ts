import type { EngineeringDocument } from './document';
import type { GeometryResult } from './kernel';
export class GeometryClient {
  private worker: Worker | null = null;
  private sequence = 0;
  private pending = new Map<number, { resolve: (value: GeometryResult | Blob | EngineeringDocument) => void; reject: (error: Error) => void; cleanup: () => void }>();
  private ensureWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('./geometry.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = ({ data }) => {
        const pending = this.pending.get(data.id);
        if (!pending) return;
        this.pending.delete(data.id); pending.cleanup();
        if (data.error) pending.reject(new Error(data.error)); else pending.resolve(data.data);
      };
      this.worker.onerror = () => this.dispose(new Error('Geometry worker failed to load'));
    }
    return this.worker;
  }
  request(document: EngineeringDocument, format?: 'step' | 'stl' | 'projection', signal?: AbortSignal): Promise<GeometryResult | Blob | EngineeringDocument> {
    if (signal?.aborted) return Promise.reject(new DOMException('Cancelled', 'AbortError'));
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const cancel = () => this.dispose(new DOMException('Cancelled', 'AbortError'));
      const timeout = setTimeout(() => this.dispose(new Error('Geometry computation timed out')), 120000);
      this.pending.set(id, { resolve, reject, cleanup: () => { clearTimeout(timeout); signal?.removeEventListener('abort', cancel); } });
      signal?.addEventListener('abort', cancel, { once: true });
      try { this.ensureWorker().postMessage({ id, document, format }); }
      catch (error) { this.dispose(error instanceof Error ? error : new Error(String(error))); }
    });
  }
  dispose(error = new Error('Geometry worker disposed')): void {
    this.worker?.terminate(); this.worker = null;
    for (const pending of this.pending.values()) { pending.cleanup(); pending.reject(error); }
    this.pending.clear();
  }
}
