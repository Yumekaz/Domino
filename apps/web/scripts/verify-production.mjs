import { readdir, readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import { log } from 'node:console';
const assets = new URL('../dist/assets/', import.meta.url);
if ((await readdir(new URL('../dist/', import.meta.url))).includes('qa')) {
  throw new Error('The development renderer harness must not be a production entry.');
}
const files = await readdir(assets);
const markers = [
  'SYNTHETIC:',
  'fixture-discussion',
  'Development-only simulated job.',
  'fixture-contribution',
  'RENDERER HARNESS - NOT REPOSITORY EVIDENCE',
  'harness/record-',
];
for (const file of files.filter((file) => file.endsWith('.js'))) {
  const content = await readFile(new URL(file, assets), 'utf8');
  if (file.includes('fixtureAdapter') || markers.some((marker) => content.includes(marker))) {
    throw new Error(`Development fixture content leaked into ${file}`);
  }
}
log('PASS: production JavaScript contains no development fixture adapter or synthetic evidence.');
