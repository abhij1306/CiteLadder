import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { expect } from 'vitest';

type TextItem = { str: string; transform: number[]; width: number };

/**
 * A page's text as a reader copies it: runs drawn edge to edge on one line
 * (one string set in two faces, such as a figure's digits and its suffix)
 * join without a space; separate strings are separated by one.
 */
function pageText(items: readonly TextItem[]) {
  let text = '';
  let end: { x: number; y: number } | null = null;
  for (const item of items) {
    const [, , , , x = 0, y = 0] = item.transform;
    const abuts = end !== null && Math.abs(end.y - y) < 0.01 && Math.abs(end.x - x) < 0.01;
    text += text && !abuts ? ` ${item.str}` : item.str;
    end = { x: x + item.width, y };
  }
  return text;
}

/** Each page's extracted text; also checks every text run stays inside the page margins. */
export async function pdfText(bytes: Uint8Array) {
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false });
  const document = await task.promise;
  const pages: string[] = [];
  try {
    for (let index = 1; index <= document.numPages; index++) {
      const page = await document.getPage(index);
      const content = await page.getTextContent();
      pages.push(pageText(content.items.filter((item) => 'str' in item)));
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
