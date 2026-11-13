import { describe, expect, it } from 'vite-plus/test';

import { readCsvFileText } from './read-file-text';

/** `name\nCafé\n` as Windows-1252 bytes: `é` is the single byte 0xE9, not UTF-8. */
const WINDOWS_1252_CAFE = new Uint8Array([
  0x6e, 0x61, 0x6d, 0x65, 0x0a, 0x43, 0x61, 0x66, 0xe9, 0x0a,
]);

describe('readCsvFileText', () => {
  it('reads a UTF-8 file, accents included', async () => {
    const file = new File(['name\nCafé\n'], 'products.csv', { type: 'text/csv' });

    await expect(readCsvFileText(file)).resolves.toBe('name\nCafé\n');
  });

  it('drops a UTF-8 byte-order mark, as Excel writes CSV UTF-8', async () => {
    const file = new File(['﻿sku,name\n1,Widget\n'], 'products.csv', { type: 'text/csv' });

    await expect(readCsvFileText(file)).resolves.toBe('sku,name\n1,Widget\n');
  });

  it('refuses a Windows-1252 file with guidance instead of importing Caf�', async () => {
    const file = new File([WINDOWS_1252_CAFE], 'products.csv', { type: 'text/csv' });

    await expect(readCsvFileText(file)).rejects.toThrow(
      'This file is not UTF-8 text. Save as CSV UTF-8 and upload again.',
    );
  });

  it('reads through FileReader when the File has no arrayBuffer()', async () => {
    const file = new File(['sku,name\n2,Gadget\n'], 'products.csv', { type: 'text/csv' });
    Object.defineProperty(file, 'arrayBuffer', { value: undefined });

    await expect(readCsvFileText(file)).resolves.toBe('sku,name\n2,Gadget\n');
  });

  it('refuses a file that cannot be read', async () => {
    const file = new File(['sku\n'], 'products.csv', { type: 'text/csv' });
    Object.defineProperty(file, 'arrayBuffer', {
      value: () => Promise.reject(new DOMException('gone', 'NotReadableError')),
    });

    await expect(readCsvFileText(file)).rejects.toThrow(
      'The file could not be read. Choose it again.',
    );
  });
});
