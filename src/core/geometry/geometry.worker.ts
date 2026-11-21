import initOpenCascade from 'replicad-opencascadejs';
import wasmUrl from 'replicad-opencascadejs/wasm?url';
import { setOC } from 'replicad';
import { buildGeometry } from './kernel';
import type { EngineeringDocument } from './document';
const ready = initOpenCascade({ locateFile: () => wasmUrl }).then(setOC);
let queue = Promise.resolve();
self.onmessage = (event: MessageEvent<{ id: number; document: EngineeringDocument; format?: 'step' | 'stl' | 'projection' }>) => {
  const request = event.data;
  queue = queue.then(async () => {
    try {
      await ready;
      const built = buildGeometry(request.document);
      try {
        const data = request.format === 'projection' ? built.project() : request.format ? (request.format === 'step' ? built.step() : built.stl()) : built.result;
        self.postMessage({ id: request.id, data });
      } finally { built.dispose(); }
    } catch (error) { self.postMessage({ id: request.id, error: error instanceof Error ? error.message : String(error) }); }
  });
};
