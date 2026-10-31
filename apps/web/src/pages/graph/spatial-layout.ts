import type { SpatialLayoutInput, SpatialLayoutOutput } from './spatial-layout.worker';

/** Terminating the dedicated worker also cancels an interrupted layout. */
export function spatialLayout(input: SpatialLayoutInput) {
  const worker = new Worker(new URL('./spatial-layout.worker.ts', import.meta.url), {
    type: 'module',
  });
  let rejectLayout: (error: Error) => void = () => {};
  let timer: ReturnType<typeof setTimeout>;
  const promise = new Promise<Record<string, { x: number; y: number }>>((resolve, reject) => {
    rejectLayout = reject;
    timer = setTimeout(() => reject(new Error('Spatial layout exceeded its time budget')), 15000);
    worker.onerror = () => reject(new Error('Spatial layout could not start'));
    worker.onmessage = (event: MessageEvent<SpatialLayoutOutput>) => {
      if ('error' in event.data) {
        reject(new Error(event.data.error));
        return;
      }
      const positions = event.data.positions;
      if (
        !input.nodes.every(
          (node) =>
            positions[node.id] &&
            Number.isFinite(positions[node.id].x) &&
            Number.isFinite(positions[node.id].y),
        )
      ) {
        reject(new Error('Incomplete layout'));
        return;
      }
      resolve(positions);
    };
    worker.postMessage(input);
  }).finally(() => {
    clearTimeout(timer);
    worker.terminate();
  });
  return {
    promise,
    cancel: () => {
      worker.terminate();
      rejectLayout(new DOMException('Layout cancelled', 'AbortError'));
    },
  };
}
