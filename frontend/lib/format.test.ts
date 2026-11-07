import { describe, expect, it } from 'vite-plus/test';

import { readableUrl } from './format';

describe('readableUrl', () => {
  it('decodes a doubly encoded path to what a reader expects', () => {
    expect(readableUrl('https://shop.test/Women%2527s-Clothing/Tops%2520%2526%2520Tees')).toBe(
      "https://shop.test/Women's-Clothing/Tops & Tees",
    );
  });

  it('keeps a malformed escape as text instead of failing', () => {
    expect(readableUrl('/sale-100%-off')).toBe('/sale-100%-off');
  });
});
