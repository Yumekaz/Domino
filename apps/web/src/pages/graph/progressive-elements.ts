import type { Core, ElementDefinition } from 'cytoscape';

/** Give the browser a paint/input opportunity, not another microtask in the same frame. */
export function nextGraphFrame(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const abort = () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      reject(signal.reason);
    };
    const frame = requestAnimationFrame(() => {
      timer = setTimeout(() => {
        signal.removeEventListener('abort', abort);
        resolve();
      }, 0);
    });
    signal.addEventListener('abort', abort, { once: true });
  });
}

/** Nodes precede their real edges. Cancellation never writes into an obsolete graph. */
export async function populateGraph(
  cy: Core,
  elements: ElementDefinition[],
  signal: AbortSignal,
  yieldFrame = nextGraphFrame,
) {
  let offset = 0;
  while (offset < elements.length) {
    await yieldFrame(signal);
    signal.throwIfAborted();
    if (cy.destroyed()) return;
    const started = performance.now();
    // The first glyph/font cache allocation gets its own frame as well.
    const batchLimit = offset === 0 ? 1 : elements[offset].data.source ? 24 : 6;
    let count = 0;
    cy.batch(() => {
      while (offset < elements.length && count < batchLimit && performance.now() - started < 5) {
        cy.add(elements[offset++]);
        count++;
      }
    });
  }
}
