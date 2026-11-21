import { describe, expect, it } from 'vitest';

import { brandPalette } from '../src/documents/pdf-brand.ts';

const channels = (hex: string) =>
  [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16));

describe('PDF brand palette', () => {
  it('paints the light tokens globals.css writes in oklch as their sRGB hex', async () => {
    const palette = await brandPalette();
    expect(
      Object.fromEntries(Object.entries(palette).map(([tone, hex]) => [tone, channels(hex)])),
    ).toEqual({
      ink: [17, 17, 17],
      inkSecondary: [82, 82, 82],
      inkMuted: [82, 82, 82],
      accent: [232, 80, 26],
      accentInk: [181, 58, 12],
      surfaceSunken: [236, 236, 236],
      line: [229, 229, 229],
      negative: [196, 18, 47],
      negativeSoft: [255, 226, 230],
      warning: [138, 80, 0],
      warningSoft: [255, 240, 209],
    });
    expect(palette.ink).toMatch(/^#[0-9a-f]{6}$/u);
  });
});
