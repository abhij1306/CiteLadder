/** Static branded documents: local fonts, measured wrapping, bounded page layout. */
import PDFDocument from 'pdfkit';

import {
  brandPalette,
  drawLogo,
  type FaceChain,
  type Palette,
  registerFaces,
  type Style,
  TEXT_FEATURES,
  type Tone,
} from './pdf-brand.ts';

const MARGIN = 50;
/** Where content starts on a page after the first, below the running logo. */
const CONTINUATION_TOP = 56;
/** Content ends here; the footer sits below. */
const BOTTOM_GAP = 60;
const CELL_PAD = 6;
const CELL_Y_PAD = 5;
const TABLE_LINE = 12.5;
const TABLE_HEADER = 20;

type Run = { font: string; text: string; width: number };
type Ink = Readonly<{ size: number; style: Style; tone: Tone }>;
export type Column = { header: string; width: number; align?: 'left' | 'right' };
export type Stat = { label: string; value: string; note: string };
export type Tag = { label: string; tone: 'danger' | 'warning' | 'neutral' };
export type RankedItem = { rank: string; title: string; detail: string; tag: Tag | null };
/** A paragraph, or a set of short labels shown as chips. */
export type Fact = { label: string; value: string | readonly string[] };
type Chip = { label: string; x: number; width: number };

const TAG_TONES: Record<Tag['tone'], { ink: Tone; fill: Tone }> = {
  danger: { ink: 'dangerText', fill: 'dangerBg' },
  warning: { ink: 'warningText', fill: 'warningBg' },
  neutral: { ink: 'secondary', fill: 'well' },
};

/** No HTML interpretation, remote fonts, scripts, attachments or interactive fields. */
export class PdfReport {
  private readonly document: PDFKit.PDFDocument;
  private readonly faces: Record<Style, FaceChain>;
  private readonly palette: Palette;
  private readonly footer: string;
  private readonly completed: Promise<Uint8Array>;
  /** The top of the next element, in points from the top of the page. */
  private y = MARGIN;
  readonly width: number;

  private constructor(
    document: PDFKit.PDFDocument,
    {
      faces,
      palette,
      footer,
    }: Readonly<{ faces: Record<Style, FaceChain>; palette: Palette; footer: string }>,
  ) {
    this.document = document;
    this.faces = faces;
    this.palette = palette;
    this.footer = footer;
    this.width = document.page.width - MARGIN * 2;
    this.completed = new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      document.on('data', (chunk: Buffer) => chunks.push(chunk));
      document.on('end', () => resolve(Buffer.concat(chunks)));
      document.on('error', reject);
    });
  }

  static async create({
    title,
    author = 'CiteLadder',
    footer = 'CiteLadder',
  }: Readonly<{ title: string; author?: string; footer?: string }>): Promise<PdfReport> {
    const document = new PDFDocument({
      size: 'A4',
      margin: 0,
      bufferPages: true,
      info: { Title: title, Author: author, Creator: 'CiteLadder' },
    });
    const [faces, palette] = await Promise.all([registerFaces(document), brandPalette()]);
    return new PdfReport(document, { faces, palette, footer });
  }

  private get bottom(): number {
    return this.document.page.height - BOTTOM_GAP;
  }

  private runs(text: string, size: number, style: Style): Run[] {
    const faces = this.faces[style];
    const runs: Run[] = [];
    for (const character of text) {
      const code = character.codePointAt(0) ?? 0;
      const face = faces.find((item) => item.characters.has(code));
      // Unsupported scripts remain inspectable instead of turning identity into blank glyphs.
      const font = face?.name ?? faces[0].name;
      const value = face ? character : `[U+${code.toString(16).toUpperCase()}]`;
      const previous = runs.at(-1);
      if (previous?.font === font) previous.text += value;
      else runs.push({ font, text: value, width: 0 });
    }
    for (const run of runs)
      run.width = this.document
        .font(run.font)
        .fontSize(size)
        .widthOfString(run.text, { features: TEXT_FEATURES });
    return runs;
  }

  private measure(text: string, size: number, style: Style): number {
    return this.runs(text, size, style).reduce((total, run) => total + run.width, 0);
  }

  private wrap(text: string, size: number, style: Style, width: number): string[] {
    const lines: string[] = [];
    for (const paragraph of text.replaceAll(/\r\n?/gu, '\n').split('\n')) {
      let line = '';
      for (const word of paragraph.trim().split(/\s+/u)) {
        if (line && this.measure(`${line} ${word}`, size, style) <= width) {
          line += ` ${word}`;
          continue;
        }
        if (line) lines.push(line);
        line = this.breakWord(word, lines, size, style, width);
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
    style: Style,
    width: number,
  ): string {
    let line = '';
    for (const character of word) {
      if (line && this.measure(line + character, size, style) > width) {
        lines.push(line);
        line = '';
      }
      line += character;
    }
    return line;
  }

  /** One line cut to a width with an ellipsis. */
  private fit(text: string, size: number, style: Style, width: number): string {
    if (this.measure(text, size, style) <= width) return text;
    let cut = text;
    while (cut && this.measure(`${cut}…`, size, style) > width) cut = cut.slice(0, -1);
    return `${cut.trimEnd()}…`;
  }

  /** Draws one line with its alphabetic baseline at `baseline`. */
  private draw(text: string, x: number, baseline: number, { size, style, tone }: Ink): void {
    for (const run of this.runs(text, size, style)) {
      this.document
        .font(run.font)
        .fontSize(size)
        .fillColor(this.palette[tone])
        .text(run.text, x, baseline, {
          lineBreak: false,
          baseline: 'alphabetic',
          features: TEXT_FEATURES,
        });
      x += run.width;
    }
  }

  private fill(tone: Tone): string {
    return this.palette[tone];
  }

  private rule(y: number, tone: Tone = 'border', width = 0.6): void {
    this.document
      .moveTo(MARGIN, y)
      .lineTo(MARGIN + this.width, y)
      .lineWidth(width)
      .strokeColor(this.palette[tone])
      .stroke();
  }

  private logo(x: number, y: number, height: number): void {
    drawLogo(this.document, this.palette, { x, y, height });
  }

  newPage(): void {
    this.document.addPage();
    this.y = CONTINUATION_TOP;
  }

  private ensure(height: number): void {
    if (this.y + height > this.bottom) this.newPage();
  }

  /** The first page's brand band: logo, eyebrow, title and context lines on mint. */
  cover({
    eyebrow,
    title,
    lines,
  }: Readonly<{ eyebrow: string; title: string; lines: readonly string[] }>): void {
    const titleLines = this.wrap(title, 26, 'display', this.width);
    const contextLines = lines.flatMap((line) => this.wrap(line, 9.5, 'text', this.width));
    const height = 128 + titleLines.length * 31 + contextLines.length * 14;
    this.document.rect(0, 0, this.document.page.width, height).fill(this.fill('fieldMint'));
    this.logo(MARGIN, 36, 20);
    this.draw(eyebrow, MARGIN, 96, { size: 9, style: 'medium', tone: 'accentText' });
    let baseline = 96;
    for (const line of titleLines) {
      baseline += 31;
      this.draw(line, MARGIN, baseline, { size: 26, style: 'display', tone: 'brandInk' });
    }
    baseline += 8;
    for (const line of contextLines) {
      baseline += 14;
      this.draw(line, MARGIN, baseline, { size: 9.5, style: 'text', tone: 'secondary' });
    }
    this.y = height + 22;
  }

  /** A plain document title under the logo, for documents without a cover band. */
  title(text: string): void {
    this.logo(MARGIN, this.y, 16);
    this.y += 46;
    for (const line of this.wrap(text, 22, 'display', this.width)) {
      this.draw(line, MARGIN, this.y, { size: 22, style: 'display', tone: 'brandInk' });
      this.y += 28;
    }
  }

  heading(text: string): void {
    // Room for the heading, a table header and one row, so a heading never ends a page.
    this.ensure(90);
    this.y += 18;
    for (const line of this.wrap(text, 13.5, 'display', this.width - 10)) {
      this.document.rect(MARGIN, this.y + 1, 3, 12).fill(this.fill('accent'));
      this.draw(line, MARGIN + 10, this.y + 12, {
        size: 13.5,
        style: 'display',
        tone: 'foreground',
      });
      this.y += 18;
    }
    this.y += 6;
  }

  text(text: string, options: Readonly<{ size?: number; style?: Style; tone?: Tone }> = {}): void {
    const size = options.size ?? 9.5;
    const style = options.style ?? 'text';
    const tone = options.tone ?? 'foreground';
    const height = size * 1.45;
    for (const line of this.wrap(text, size, style, this.width)) {
      this.ensure(height);
      this.draw(line, MARGIN, this.y + size, { size, style, tone });
      this.y += height;
    }
    this.y += 4;
  }

  /** A one-time notice on a lime strip. */
  note(text: string): void {
    const lines = this.wrap(text, 9, 'medium', this.width - 24);
    const height = lines.length * 13 + 14;
    this.ensure(height + 10);
    this.document.rect(MARGIN, this.y, this.width, height).fill(this.fill('fieldLime'));
    lines.forEach((line, index) =>
      this.draw(line, MARGIN + 12, this.y + 19 + index * 13, {
        size: 9,
        style: 'medium',
        tone: 'foreground',
      }),
    );
    this.y += height + 10;
  }

  /** The recommended step, on a mint field. */
  callout({
    eyebrow,
    title,
    detail,
  }: Readonly<{ eyebrow: string; title: string; detail: string | null }>): void {
    const inner = this.width - 28;
    const titleLines = this.wrap(title, 12, 'medium', inner);
    const detailLines = detail ? this.wrap(detail, 9, 'text', inner) : [];
    const details = detailLines.length ? 2 + detailLines.length * 12.5 : 0;
    const height = 26 + titleLines.length * 16 + details + 16;
    this.y += 8;
    this.ensure(height + 10);
    const top = this.y;
    this.document.rect(MARGIN, top, this.width, height).fill(this.fill('fieldMint'));
    this.draw(eyebrow, MARGIN + 14, top + 22, { size: 8.5, style: 'medium', tone: 'accentText' });
    let baseline = top + 26;
    for (const line of titleLines) {
      baseline += 16;
      this.draw(line, MARGIN + 14, baseline, { size: 12, style: 'medium', tone: 'brandInk' });
    }
    baseline += 2;
    for (const line of detailLines) {
      baseline += 12.5;
      this.draw(line, MARGIN + 14, baseline, { size: 9, style: 'text', tone: 'secondary' });
    }
    this.y = top + height + 10;
  }

  /** Headline figures in a row of equal cells under a signal-green rule. */
  stats(stats: readonly Stat[]): void {
    if (!stats.length) return;
    const cell = this.width / stats.length;
    const room = (index: number) => cell - (index ? 12 : 0) - 8;
    // Every note line prints; the strip grows to the longest note.
    const notes = stats.map((stat, index) => this.wrap(stat.note, 8, 'text', room(index)));
    const height = 74 + Math.max(...notes.map((lines) => lines.length)) * 10.5;
    this.ensure(height + 10);
    const top = this.y;
    this.rule(top, 'accent', 1.5);
    stats.forEach((stat, index) => {
      const x = MARGIN + index * cell + (index ? 12 : 0);
      const width = room(index);
      if (index)
        this.document
          .moveTo(MARGIN + index * cell, top + 12)
          .lineTo(MARGIN + index * cell, top + height - 8)
          .lineWidth(0.6)
          .strokeColor(this.palette.border)
          .stroke();
      this.draw(this.fit(stat.label, 8.5, 'medium', width), x, top + 20, {
        size: 8.5,
        style: 'medium',
        tone: 'secondary',
      });
      const figure = this.measure(stat.value, 24, 'display');
      const size = figure > width ? Math.max(12, (24 * width) / figure) : 24;
      this.draw(stat.value, x, top + 50, { size, style: 'display', tone: 'brandInk' });
      notes[index]?.forEach((line, row) =>
        this.draw(line, x, top + 66 + row * 10.5, { size: 8, style: 'text', tone: 'muted' }),
      );
    });
    this.y = top + height + 4;
  }

  table({
    columns,
    rows,
  }: Readonly<{ columns: readonly Column[]; rows: readonly (readonly string[])[] }>): void {
    if (!columns.length || columns.some((column) => column.width <= 0))
      throw new Error('Invalid PDF columns');
    const sum = columns.reduce((total, column) => total + column.width, 0);
    let next = MARGIN;
    const layout = columns.map((column) => {
      const width = (column.width / sum) * this.width;
      const left = next;
      next += width;
      return { ...column, left, width };
    });
    const cellX = (column: (typeof layout)[number], text: string, size: number, style: Style) =>
      column.align === 'right'
        ? column.left + column.width - CELL_PAD - this.measure(text, size, style)
        : column.left + CELL_PAD;
    const header = () => {
      for (const column of layout)
        this.draw(column.header, cellX(column, column.header, 8, 'medium'), this.y + 13, {
          size: 8,
          style: 'medium',
          tone: 'secondary',
        });
      this.y += TABLE_HEADER;
      this.rule(this.y, 'borderStrong', 0.8);
    };
    const wrapped = rows.map((row) => {
      if (row.length !== layout.length) throw new Error('Invalid PDF row');
      return layout.map((column, index) => ({
        column,
        lines: this.wrap(row[index] ?? '', 9, 'text', column.width - CELL_PAD * 2),
      }));
    });
    const capacity = Math.floor(
      (this.bottom - CONTINUATION_TOP - TABLE_HEADER - CELL_Y_PAD * 2) / TABLE_LINE,
    );
    const first = Math.min(Math.max(1, ...(wrapped[0] ?? []).map((cell) => cell.lines.length)), 4);
    // A header always keeps at least the start of its first row beside it.
    this.ensure(TABLE_HEADER + first * TABLE_LINE + CELL_Y_PAD * 2);
    header();
    wrapped.forEach((cells, rowIndex) => {
      const count = Math.max(1, ...cells.map((cell) => cell.lines.length));
      let start = 0;
      while (start < count) {
        const room = Math.floor((this.bottom - this.y - CELL_Y_PAD * 2) / TABLE_LINE);
        // Move a row that fits on a page whole; split only a row taller than a page.
        if (room < 1 || (start === 0 && count <= capacity && room < count)) {
          this.newPage();
          header();
          continue;
        }
        const end = Math.min(count, start + room);
        const height = (end - start) * TABLE_LINE + CELL_Y_PAD * 2;
        if (rowIndex % 2 === 1)
          this.document.rect(MARGIN, this.y, this.width, height).fill(this.fill('backgroundAlt'));
        for (const { column, lines } of cells)
          lines.slice(start, end).forEach((line, offset) =>
            this.draw(
              line,
              cellX(column, line, 9, 'text'),
              this.y + CELL_Y_PAD + 9.5 + offset * TABLE_LINE,
              {
                size: 9,
                style: 'text',
                tone: 'foreground',
              },
            ),
          );
        this.y += height;
        start = end;
      }
    });
    this.rule(this.y);
    this.y += 10;
  }

  /** A numbered list: rank, title, a detail line and an optional tag. */
  ranked(items: readonly RankedItem[]): void {
    const tagColumn = 78;
    const textX = MARGIN + 26;
    const textWidth = this.width - 26 - tagColumn;
    for (const item of items) {
      const titleLines = this.wrap(item.title, 10, 'medium', textWidth);
      const detailLines = item.detail ? this.wrap(item.detail, 8.5, 'text', textWidth) : [];
      const height = 18 + titleLines.length * 13.5 + detailLines.length * 12;
      this.ensure(height);
      const top = this.y;
      this.draw(item.rank, MARGIN, top + 20, { size: 12, style: 'display', tone: 'accentText' });
      titleLines.forEach((line, index) =>
        this.draw(line, textX, top + 20 + index * 13.5, {
          size: 10,
          style: 'medium',
          tone: 'foreground',
        }),
      );
      detailLines.forEach((line, index) =>
        this.draw(line, textX, top + 20 + titleLines.length * 13.5 + index * 12, {
          size: 8.5,
          style: 'text',
          tone: 'muted',
        }),
      );
      if (item.tag) {
        const tones = TAG_TONES[item.tag.tone];
        const width = this.measure(item.tag.label, 7.5, 'medium') + 14;
        const x = MARGIN + this.width - width;
        this.document.roundedRect(x, top + 9, width, 15, 7.5).fill(this.fill(tones.fill));
        this.draw(item.tag.label, x + 7, top + 19.5, {
          size: 7.5,
          style: 'medium',
          tone: tones.ink,
        });
      }
      this.y = top + height;
      this.rule(this.y);
    }
    this.y += 10;
  }

  /** Labelled facts: paragraphs or chip sets beside a label column. */
  facts(facts: readonly Fact[]): void {
    const labelWidth = 118;
    const valueX = MARGIN + labelWidth;
    const valueWidth = this.width - labelWidth;
    for (const fact of facts) {
      const chips = typeof fact.value === 'string' ? null : this.chipRows(fact.value, valueWidth);
      const lines =
        typeof fact.value === 'string' ? this.wrap(fact.value, 9.5, 'text', valueWidth) : [];
      const height = chips ? chips.length * 22 + 12 : lines.length * 13.5 + 14;
      this.ensure(height);
      const top = this.y;
      this.draw(fact.label, MARGIN, top + 18, { size: 8.5, style: 'medium', tone: 'secondary' });
      lines.forEach((line, index) =>
        this.draw(line, valueX, top + 18 + index * 13.5, {
          size: 9.5,
          style: 'text',
          tone: 'foreground',
        }),
      );
      chips?.forEach((row, index) =>
        row.forEach((chip) => {
          const y = top + 7 + index * 22;
          this.document
            .roundedRect(valueX + chip.x, y, chip.width, 17, 8.5)
            .fill(this.fill('well'));
          this.draw(chip.label, valueX + chip.x + 8, y + 12, {
            size: 8.5,
            style: 'text',
            tone: 'foreground',
          });
        }),
      );
      this.y = top + height;
      this.rule(this.y);
    }
    this.y += 10;
  }

  private chipRows(labels: readonly string[], width: number): Chip[][] {
    let row: Chip[] = [];
    const rows = [row];
    let x = 0;
    for (const raw of labels) {
      const label = this.fit(raw, 8.5, 'text', width - 16);
      const chipWidth = this.measure(label, 8.5, 'text') + 16;
      if (x && x + chipWidth > width) {
        row = [];
        rows.push(row);
        x = 0;
      }
      row.push({ label, x, width: chipWidth });
      x += chipWidth + 6;
    }
    return rows;
  }

  async save(): Promise<Uint8Array> {
    const pages = this.document.bufferedPageRange();
    const height = this.document.page.height;
    const ink: Ink = { size: 8, style: 'text', tone: 'muted' };
    for (let index = pages.start; index < pages.start + pages.count; index++) {
      this.document.switchToPage(index);
      if (index > pages.start) this.logo(MARGIN, 28, 11);
      this.rule(height - 44);
      const right = `citeladder.com  ·  Page ${index - pages.start + 1} of ${pages.count}`;
      const rightWidth = this.measure(right, 8, 'text');
      this.draw(right, MARGIN + this.width - rightWidth, height - 30, ink);
      const left = this.fit(this.footer, 8, 'text', this.width - rightWidth - 16);
      this.draw(left, MARGIN, height - 30, ink);
    }
    this.document.end();
    return this.completed;
  }
}
