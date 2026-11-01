import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { expect } from 'vitest';

/** Each page's extracted text; also checks every text run stays inside the page margins. */
export async function pdfText(bytes: Uint8Array) {
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false });
  const document = await task.promise;
  const pages: string[] = [];
  try {
    for (let index = 1; index <= document.numPages; index++) {
      const page = await document.getPage(index);
      const content = await page.getTextContent();
      pages.push(
        content.items
          .filter((item) => 'str' in item)
          .map((item) => item.str)
          .join(' '),
      );
      const viewport = page.getViewport({ scale: 1 });
      for (const item of content.items) {
        if (!('str' in item) || !item.str.trim()) continue;
        expect(item.transform[4]).toBeGreaterThanOrEqual(49);
        expect(item.transform[4] + item.width).toBeLessThanOrEqual(viewport.width - 49);
        expect(item.transform[5]).toBeGreaterThanOrEqual(24);
      }
    }
    return pages;
  } finally {
    await task.destroy();
  }
}
