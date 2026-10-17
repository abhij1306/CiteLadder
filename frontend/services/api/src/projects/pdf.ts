/** Static documents: local fonts, measured wrapping, bounded page layout. */
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

import { create as parseFont } from 'fontkit';
import PDFDocument from 'pdfkit';

const require = createRequire(import.meta.url);
const fontDirectory = join(dirname(require.resolve('@fontsource/noto-sans/package.json')), 'files');
const MARGIN = 50;
const FOOTER = 44;
type Face = { name: string; characters: ReadonlySet<number>; bold: boolean };
type Run = { font: string; text: string; width: number };
let fontBytes:
  | Promise<{ bytes: Buffer; bold: boolean; characters: ReadonlySet<number> }[]>
  | undefined;

function localFonts() {
  fontBytes ??= readdir(fontDirectory).then(async (names) =>
    Promise.all(
      names
        .filter((name) => /-(400|700)-normal\.woff$/u.test(name))
        .sort(
          (a, b) =>
            Number(!a.includes('-latin-')) - Number(!b.includes('-latin-')) || a.localeCompare(b),
        )
        .map(async (name) => {
          const bytes = await readFile(join(fontDirectory, name));
          const parsed = parseFont(bytes);
          if (!('characterSet' in parsed)) throw new Error('Expected a local single-face font');
          return { bytes, bold: name.includes('-700-'), characters: new Set(parsed.characterSet) };
        }),
    ),
  );
  // A transient read or parse failure must not fail every later document in this process.
  fontBytes.catch(() => {
    fontBytes = undefined;
  });
  return fontBytes;
}

/** No HTML interpretation, remote fonts, scripts, attachments or interactive fields. */
export class PdfReport {
  private readonly document: PDFKit.PDFDocument;
  private readonly faces: Face[];
  private readonly completed: Promise<Uint8Array>;
  private y: number;
  readonly width: number;

  private constructor(document: PDFKit.PDFDocument, faces: Face[]) {
    this.document = document;
    this.faces = faces;
    this.y = document.page.height - MARGIN;
    this.width = document.page.width - MARGIN * 2;
    this.completed = new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      document.on('data', (chunk: Buffer) => chunks.push(chunk));
      document.on('end', () => resolve(Buffer.concat(chunks)));
      document.on('error', reject);
    });
  }

  static async create(title: string, author = 'CiteLadder'): Promise<PdfReport> {
    const document = new PDFDocument({
      size: 'A4',
      margin: 0,
      bufferPages: true,
      info: { Title: title, Author: author, Creator: 'CiteLadder' },
    });
    const faces = (await localFonts()).map(({ bytes, bold, characters }, index) => {
      const name = `local-${index}`;
      document.registerFont(name, bytes);
      return { name, characters, bold };
    });
    return new PdfReport(document, faces);
  }

  private runs(text: string, size: number, bold: boolean): Run[] {
    const runs: Run[] = [];
    for (const character of text) {
      const face = this.faces.find(
        (item) => item.bold === bold && item.characters.has(character.codePointAt(0)!),
      );
      // Unsupported scripts remain inspectable instead of turning identity into blank glyphs.
      const font = face?.name ?? this.faces.find((item) => item.bold === bold)!.name;
      const value = face
        ? character
        : `[U+${character.codePointAt(0)!.toString(16).toUpperCase()}]`;
      const previous = runs.at(-1);
      if (previous?.font === font) previous.text += value;
      else runs.push({ font, text: value, width: 0 });
    }
    for (const run of runs)
      run.width = this.document.font(run.font).fontSize(size).widthOfString(run.text);
    return runs;
  }

  private measure(text: string, size: number, bold: boolean): number {
    return this.runs(text, size, bold).reduce((total, run) => total + run.width, 0);
  }

  private wrap(text: string, size: number, bold: boolean, width: number): string[] {
    const lines: string[] = [];
    for (const paragraph of text.replaceAll(/\r\n?/gu, '\n').split('\n')) {
      let line = '';
      for (const word of paragraph.trim().split(/\s+/u)) {
        if (line && this.measure(`${line} ${word}`, size, bold) <= width) {
          line += ` ${word}`;
          continue;
        }
        if (line) lines.push(line);
        line = this.breakWord(word, lines, size, bold, width);
      }
      lines.push(line);
    }
    return lines;
  }

  /** Splits a word wider than the line per character; returns the unfinished last line. */
  private breakWord(
    word: string,
    lines: string[],
    size: number,
    bold: boolean,
    width: number,
  ): string {
    let line = '';
    for (const character of word) {
      if (line && this.measure(line + character, size, bold) > width) {
        lines.push(line);
        line = '';
      }
      line += character;
    }
    return line;
  }

  newPage(): void {
    this.document.addPage();
    this.y = this.document.page.height - MARGIN;
  }

  private ensure(height: number): void {
    if (this.y - height < FOOTER) this.newPage();
  }

  private draw(text: string, x: number, y: number, size: number, bold: boolean): void {
    for (const run of this.runs(text, size, bold)) {
      this.document
        .font(run.font)
        .fontSize(size)
        .text(run.text, x, this.document.page.height - y, {
          lineBreak: false,
          baseline: 'alphabetic',
        });
      x += run.width;
    }
  }

  text(text: string, options: { size?: number; bold?: boolean } = {}): void {
    const size = options.size ?? 10;
    const bold = options.bold ?? false;
    for (const line of this.wrap(text, size, bold, this.width)) {
      this.ensure(size * 1.5);
      this.draw(line, MARGIN, this.y - size, size, bold);
      this.y -= size * 1.5;
    }
    this.y -= 4;
  }

  heading(text: string): void {
    // Room for the heading, a table header and one row, so a heading never ends a page.
    this.ensure(100);
    this.y -= 12;
    this.text(text, { size: 13, bold: true });
  }

  title(text: string): void {
    this.text('CiteLadder', { bold: true });
    this.text(text, { size: 22, bold: true });
  }

  table(
    headers: readonly string[],
    rows: readonly (readonly string[])[],
    fractions: readonly number[],
  ): void {
    if (headers.length !== fractions.length || fractions.some((value) => value <= 0))
      throw new Error('Invalid PDF columns');
    const sum = fractions.reduce((a, b) => a + b, 0);
    const widths = fractions.map((value) => (value / sum) * this.width);
    const drawRow = (cells: readonly string[], bold: boolean) => {
      const lines = cells.map((cell, i) => this.wrap(cell, 9, bold, widths[i]! - 12));
      const count = Math.max(...lines.map((cell) => cell.length));
      for (let index = 0; index < count; index++) {
        if (this.y - 14 < FOOTER) {
          this.newPage();
          if (!bold) drawRow(headers, true);
        }
        let x = MARGIN + 6;
        lines.forEach((cell, column) => {
          this.draw(cell[index] ?? '', x, this.y - 10, 9, bold);
          x += widths[column]!;
        });
        this.y -= 14;
      }
      this.y -= 8;
      const top = this.document.page.height - this.y;
      this.document
        .lineWidth(0.4)
        .moveTo(MARGIN, top)
        .lineTo(MARGIN + this.width, top)
        .stroke();
      this.y -= 5;
    };
    drawRow(headers, true);
    for (const row of rows) {
      if (row.length !== headers.length) throw new Error('Invalid PDF row');
      const height =
        Math.max(...row.map((cell, i) => this.wrap(cell, 9, false, widths[i]! - 12).length)) * 14 +
        13;
      const pageCapacity = this.document.page.height - MARGIN - FOOTER - 40;
      if (height <= pageCapacity && this.y - height < FOOTER) {
        this.newPage();
        drawRow(headers, true);
      }
      drawRow(row, false);
    }
  }

  async save(): Promise<Uint8Array> {
    const pages = this.document.bufferedPageRange();
    for (let index = pages.start; index < pages.start + pages.count; index++) {
      this.document.switchToPage(index);
      this.draw(`CiteLadder | ${index + 1} / ${pages.count}`, MARGIN, 25, 8, false);
    }
    this.document.end();
    return this.completed;
  }
}
