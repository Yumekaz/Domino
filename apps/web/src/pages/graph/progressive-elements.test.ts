import { describe, expect, it } from 'vitest';
import cytoscape, { type ElementDefinition } from 'cytoscape';
import { populateGraph } from './progressive-elements';

const elements: ElementDefinition[] = [
  ...Array.from({ length: 40 }, (_, i) => ({ data: { id: `node:${i}`, title: `record ${i}` } })),
  ...Array.from({ length: 39 }, (_, i) => ({
    data: {
      id: `edge:${i}`,
      source: `node:${i}`,
      target: `node:${i + 1}`,
      verification: 'observed',
    },
  })),
  { data: { id: 'disconnected', title: 'Separate record' } },
];

describe('interruptible graph preparation', () => {
  it('yields while keeping every record, edge direction and provenance field', async () => {
    const cy = cytoscape({ headless: true });
    let yields = 0;
    try {
      await populateGraph(cy, elements, new AbortController().signal, async () => {
        yields++;
      });
      expect(yields).toBeGreaterThan(1);
      expect(
        cy
          .elements()
          .map((item) => item.id())
          .sort(),
      ).toEqual(elements.map((item) => item.data.id).sort());
      expect(cy.getElementById('edge:4').data()).toMatchObject({
        source: 'node:4',
        target: 'node:5',
        verification: 'observed',
      });
      expect(cy.getElementById('disconnected').degree()).toBe(0);
    } finally {
      cy.destroy();
    }
  });
  it('does not write another batch after a route or presentation switch cancels it', async () => {
    const cy = cytoscape({ headless: true });
    const controller = new AbortController();
    let yields = 0,
      atCancellation = 0;
    try {
      await expect(
        populateGraph(cy, elements, controller.signal, async () => {
          if (++yields === 2) {
            atCancellation = cy.elements().length;
            controller.abort();
          }
        }),
      ).rejects.toMatchObject({ name: 'AbortError' });
      expect(atCancellation).toBeGreaterThan(0);
      expect(cy.elements().length).toBe(atCancellation);
      expect(cy.edges()).toHaveLength(0);
    } finally {
      cy.destroy();
    }
  });
  it('does not initialize an obsolete renderer destroyed while waiting to yield', async () => {
    const cy = cytoscape({ headless: true });
    await populateGraph(cy, elements, new AbortController().signal, async () => {
      cy.destroy();
    });
    expect(cy.elements()).toHaveLength(0);
  });
});
