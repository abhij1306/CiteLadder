import { describe, expect, it } from 'vitest';

import { readAttachmentFile } from './attachment-file';

const file = (name: string, content: BlobPart) => new File([content], name);

describe('readAttachmentFile', () => {
  it('reads text files as a named file attachment and refuses what it cannot carry', async () => {
    const rows = 'prompt,topic\nWhich shoes grip in mud?,Trail';
    const cases: [File, number, unknown][] = [
      [
        file('prompts.CSV', rows),
        100,
        { kind: 'attached', attachment: { kind: 'file', name: 'prompts.CSV', text: rows } },
      ],
      [
        file('facts.ndjson', '{"a":1}'),
        100,
        { kind: 'attached', attachment: { kind: 'file', name: 'facts.ndjson', text: '{"a":1}' } },
      ],
      [
        file('catalog.xlsx', 'PK'),
        100,
        {
          kind: 'refused',
          message: "catalog.xlsx can't be read here. Save it as CSV, or paste the text.",
        },
      ],
      [
        file('brief.pdf', '%PDF'),
        100,
        {
          kind: 'refused',
          message: "brief.pdf can't be read here. Save it as CSV, or paste the text.",
        },
      ],
      [
        file('photo.png', 'png'),
        100,
        {
          kind: 'refused',
          message: 'Attach a CSV, TSV, JSON, NDJSON, Markdown or plain text file.',
        },
      ],
      [
        file('long.txt', 'x'.repeat(11)),
        10,
        { kind: 'refused', message: 'long.txt is longer than 10 characters. Attach part of it.' },
      ],
      [file('empty.tsv', ' \n'), 10, { kind: 'refused', message: 'empty.tsv is empty.' }],
      [
        file('latin.csv', new Uint8Array([0x63, 0x61, 0x66, 0xe9])),
        10,
        {
          kind: 'refused',
          message: 'This file is not UTF-8 text. Save as CSV UTF-8 and upload again.',
        },
      ],
    ];
    for (const [given, max, expected] of cases)
      expect(await readAttachmentFile(given, max)).toEqual(expected); // NOSONAR
  });
});
