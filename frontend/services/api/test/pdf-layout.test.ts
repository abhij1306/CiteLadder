import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';

import { PdfReport } from '../src/documents/pdf.ts';

/** Words `w001 … wNNN`, so every printed word and its order can be checked. */
const words = (count: number) =>
  Array.from({ length: count }, (_, index) => `w${String(index + 1).padStart(3, '0')}`);
const WORD = /w\d{3}/u;

/** Each page's text runs with their height above the page bottom. */
async function pages(bytes: Uint8Array) {
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false });
  const document = await task.promise;
  try {
    return await Promise.all(
      Array.from({ length: document.numPages }, async (_, index) => {
        const content = await (await document.getPage(index + 1)).getTextContent();
        return content.items.flatMap((item) =>
          'str' in item && item.str.trim() ? [{ text: item.str, y: item.transform[5] ?? 0 }] : [],
        );
      }),
    );
  } finally {
    await task.destroy();
  }
}

/** Content never reaches the footer band, and every word prints once, in order. */
async function expectPaginated(report: PdfReport, expected: readonly string[]) {
  const printed = await pages(await report.save());
  expect(printed.length).toBeGreaterThan(1);
  // The footer prints at 30pt; any word of the content counts as body wherever it lands.
  const body = printed.flatMap((items) =>
    items.filter((item) => item.y >= 40 || WORD.test(item.text)),
  );
  for (const item of body) expect(item.y).toBeGreaterThanOrEqual(60);
  expect(body.flatMap((item) => item.text.match(/w\d{3}/gu) ?? [])).toEqual(expected);
}

describe('PDF blocks taller than a page', () => {
  // One word per line: more lines than an A4 page holds.
  const long = words(120);
  const text = long.join('\n');

  it('continues a note on the next page', async () => {
    const report = await PdfReport.create({ title: 'Note' });
    report.note(text);
    await expectPaginated(report, long);
  });

  it('continues a callout on the next page', async () => {
    const report = await PdfReport.create({ title: 'Callout' });
    report.callout({ eyebrow: 'Next action', title: 'Fix the pricing page', detail: text });
    await expectPaginated(report, long);
  });

  it('continues a ranked item on the next page', async () => {
    const report = await PdfReport.create({ title: 'Ranked' });
    report.ranked([{ rank: '1', title: 'Fix the pricing page', detail: text, tag: null }]);
    await expectPaginated(report, long);
  });

  it('continues a paragraph fact and a chip fact on the next page', async () => {
    // Chips wide enough that each takes its own row.
    const chips = words(60).map((word) => `${word} ${'chip '.repeat(14)}`.trim());
    const report = await PdfReport.create({ title: 'Facts' });
    report.facts([
      { label: 'Positioning', value: text },
      { label: 'Offerings', value: chips },
    ]);
    await expectPaginated(report, [...long, ...words(60)]);
  });
});
