import { describe, expect, it } from 'vite-plus/test';

import { readCsvFileText } from './read-file-text';

/**
 * `lib/csv` had no tests. The module exists ONLY because jsdom's `File` may not
 * implement `.text()`, so the FileReader fallback is the whole point — and it
 * was the half nothing exercised.
 */
describe('readCsvFileText', () => {
  it('reads a file through the native text() path', async () => {
    const file = new File(['sku,name\n1,Widget\n'], 'products.csv', { type: 'text/csv' });

    await expect(readCsvFileText(file)).resolves.toBe('sku,name\n1,Widget\n');
  });

  it('falls back to FileReader when text() is unavailable', async () => {
    const file = new File(['sku,name\n2,Gadget\n'], 'products.csv', { type: 'text/csv' });
    Object.defineProperty(file, 'text', { value: undefined });

    await expect(readCsvFileText(file)).resolves.toBe('sku,name\n2,Gadget\n');
  });

  it('resolves an empty file to an empty string on the fallback path', async () => {
    const file = new File([], 'empty.csv', { type: 'text/csv' });
    Object.defineProperty(file, 'text', { value: undefined });

    // Not null and not a rejection: an empty upload is a valid, if useless,
    // file and the caller's parser should be the one to say so.
    await expect(readCsvFileText(file)).resolves.toBe('');
  });

  it('preserves unicode content', async () => {
    const file = new File(['name\nCafé\n'], 'products.csv', { type: 'text/csv' });

    await expect(readCsvFileText(file)).resolves.toContain('Café');
  });
});
