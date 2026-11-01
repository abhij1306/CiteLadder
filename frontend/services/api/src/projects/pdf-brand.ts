/**
 * CiteLadder's identity in PDF documents: the light design tokens read from
 * the app's token owner, the brand faces (Outfit display, Geist text, both
 * capped at weight 500) with Noto Sans behind them for scripts the brand faces
 * lack, and the logo drawn from the same outline data as the app's `LogoMark`.
 * Every face is an OFL-licensed npm package, which permits embedding the
 * subsets a document uses.
 */
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import {
  LOGO_BARS,
  LOGO_BUBBLE,
  LOGO_GLYPH_BASELINE,
  LOGO_GLYPH_SCALE,
  LOGO_GLYPH_STROKE,
  LOGO_GLYPHS,
} from '@citeladder/contracts/brand-logo';
import { create as parseFont } from 'fontkit';

/** The tokens a document paints with, by the `globals.css` custom property that owns each. */
const TOKENS = {
  brandInk: '--color-brand-ink',
  foreground: '--color-foreground',
  secondary: '--color-secondary',
  muted: '--color-muted',
  accent: '--color-accent',
  accentText: '--color-accent-text',
  // The app has no public field colours, so the cover band and callouts take
  // the soft accent and the first-run notice the stronger accent tint.
  fieldMint: '--color-accent-soft',
  fieldLime: '--color-accent-subtle',
  backgroundAlt: '--color-background-alt',
  well: '--color-well',
  border: '--color-border',
  borderStrong: '--color-border-strong',
  dangerText: '--color-danger-text',
  dangerBg: '--color-danger-bg',
  warningText: '--color-warning-text',
  warningBg: '--color-warning-bg',
} as const;
export type Tone = keyof typeof TOKENS;
export type Palette = Readonly<Record<Tone, string>>;

/** `display` sets headings and figures in Outfit; `text` and `medium` set Geist. */
export type Style = 'text' | 'medium' | 'display';
type Family = 'display' | 'text' | 'fallback';
type Weight = 400 | 500;
const STYLES: Record<Style, { families: readonly Family[]; weight: Weight }> = {
  display: { families: ['display', 'text', 'fallback'], weight: 500 },
  medium: { families: ['text', 'fallback'], weight: 500 },
  text: { families: ['text', 'fallback'], weight: 400 },
};

const require = createRequire(import.meta.url);
const fontDirectory = (packageJson: string) => join(dirname(packageJson), 'files');
const SOURCES: readonly { family: Family; directory: string; prefix: string; weights: Weight[] }[] =
  [
    {
      family: 'display',
      directory: fontDirectory(require.resolve('@fontsource/outfit/package.json')),
      prefix: 'outfit',
      weights: [500],
    },
    {
      family: 'text',
      directory: fontDirectory(require.resolve('@fontsource/geist/package.json')),
      prefix: 'geist',
      weights: [400, 500],
    },
    {
      family: 'fallback',
      directory: fontDirectory(require.resolve('@fontsource/noto-sans/package.json')),
      prefix: 'noto-sans',
      weights: [400, 500],
    },
  ];

type FontFile = { family: Family; weight: Weight; bytes: Buffer; characters: ReadonlySet<number> };
type Face = { name: string; characters: ReadonlySet<number> };
/** A style's faces in lookup order; the first is the face for unsupported glyphs. */
export type FaceChain = readonly [Face, ...Face[]];

let fontFiles: Promise<FontFile[]> | undefined;
let tokens: Promise<Palette> | undefined;

async function sourceFiles(source: (typeof SOURCES)[number]): Promise<FontFile[]> {
  const pattern = new RegExp(`^${source.prefix}-[a-z-]+-(400|500)-normal\\.woff$`, 'u');
  const names = (await readdir(source.directory))
    .filter((name) => pattern.test(name) && source.weights.some((w) => name.includes(`-${w}-`)))
    // Latin first, so the common case finds its glyphs in the first face.
    .sort(
      (a, b) =>
        Number(!a.includes('-latin-')) - Number(!b.includes('-latin-')) || a.localeCompare(b),
    );
  return Promise.all(
    names.map(async (name) => {
      const bytes = await readFile(join(source.directory, name));
      const parsed = parseFont(bytes);
      if (!('characterSet' in parsed)) throw new Error('Expected a local single-face font');
      return {
        family: source.family,
        weight: name.includes('-500-') ? 500 : 400,
        bytes,
        characters: new Set(parsed.characterSet),
      };
    }),
  );
}

/** Retries a failed load next time: a transient read error must not fail every later document. */
function cached<T>(current: Promise<T> | undefined, load: () => Promise<T>, reset: () => void) {
  const value = current ?? load();
  value.catch(reset);
  return value;
}

function localFonts(): Promise<FontFile[]> {
  fontFiles = cached(
    fontFiles,
    () => Promise.all(SOURCES.map(sourceFiles)).then((sets) => sets.flat()),
    () => {
      fontFiles = undefined;
    },
  );
  return fontFiles;
}

async function tokenSource(): Promise<string> {
  try {
    return await readFile(new URL('../../assets/design-tokens.css', import.meta.url), 'utf8');
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
    // Source-run development reads the token owner itself; the image copies
    // the identical file into the API's packaged assets before deploy.
    return readFile(new URL('../../../../apps/app/src/globals.css', import.meta.url), 'utf8');
  }
}

/** Each token's first (light) declaration, with `var()` references resolved. */
function parsePalette(css: string): Palette {
  const declared = new Map<string, string>();
  for (const match of css.matchAll(/^\s*(--[a-z0-9-]+)\s*:\s*([^;{}]+);/gimu)) {
    const [, name = '', value = ''] = match;
    if (!declared.has(name)) declared.set(name, value.trim());
  }
  const resolve = (name: string, seen: ReadonlySet<string>): string => {
    const value = declared.get(name);
    const reference = /^var\((--[a-z0-9-]+)\)$/iu.exec(value ?? '')?.[1];
    if (reference && !seen.has(reference)) return resolve(reference, new Set([...seen, name]));
    if (!value || !/^#[0-9a-f]{6}$/iu.test(value))
      throw new Error(`Design token ${name} has no light hex value`);
    return value;
  };
  const token = (tone: Tone) => resolve(TOKENS[tone], new Set());
  return {
    brandInk: token('brandInk'),
    foreground: token('foreground'),
    secondary: token('secondary'),
    muted: token('muted'),
    accent: token('accent'),
    accentText: token('accentText'),
    fieldMint: token('fieldMint'),
    fieldLime: token('fieldLime'),
    backgroundAlt: token('backgroundAlt'),
    well: token('well'),
    border: token('border'),
    borderStrong: token('borderStrong'),
    dangerText: token('dangerText'),
    dangerBg: token('dangerBg'),
    warningText: token('warningText'),
    warningBg: token('warningBg'),
  };
}

export function brandPalette(): Promise<Palette> {
  tokens = cached(
    tokens,
    async () => parsePalette(await tokenSource()),
    () => {
      tokens = undefined;
    },
  );
  return tokens;
}

/** Registers every face on the document; returns each style's faces in lookup order. */
export async function registerFaces(
  document: PDFKit.PDFDocument,
): Promise<Record<Style, FaceChain>> {
  const files = (await localFonts()).map((file, index) => {
    const name = `face-${index}`;
    document.registerFont(name, file.bytes);
    return { ...file, name };
  });
  const chain = (style: Style): FaceChain => {
    const [first, ...rest] = STYLES[style].families.flatMap((family) =>
      files.filter((file) => file.family === family && file.weight === STYLES[style].weight),
    );
    if (!first) throw new Error(`No local font for the ${style} style`);
    return [first, ...rest];
  };
  return { display: chain('display'), medium: chain('medium'), text: chain('text') };
}

/**
 * fontkit applies the faces' standard ligatures by default, and the text layer
 * then maps an fi, ff or fl glyph back to its first letter only, so copied or
 * searched text reads "frst". Tabular figures keep numeric columns aligned.
 * @types/pdfkit types only the tag-list form; pdfkit hands the value to
 * fontkit, whose tag-to-boolean form is the only way to turn a default off.
 */
export const TEXT_FEATURES = {
  liga: false,
  clig: false,
  tnum: true,
} as unknown as PDFKit.Mixins.OpenTypeFeatures[];

/** Draws the lockup with its top-left corner at (x, y), in its light values. */
export function drawLogo(
  document: PDFKit.PDFDocument,
  palette: Palette,
  { x, y, height }: Readonly<{ x: number; y: number; height: number }>,
) {
  document
    .save()
    .translate(x, y)
    .scale(height / 100);
  document.path(LOGO_BUBBLE).fill(palette.brandInk);
  for (const bar of LOGO_BARS)
    document.roundedRect(bar.x, bar.y, bar.width, bar.height, 1.1).fill(palette.accent);
  for (const glyph of LOGO_GLYPHS) {
    const color = glyph.tone === 'accent' ? palette.accent : palette.brandInk;
    // Stroke and fill share one colour, so the SVG's stroke-then-fill order is moot.
    document
      .save()
      .translate(glyph.x, LOGO_GLYPH_BASELINE)
      .scale(LOGO_GLYPH_SCALE, -LOGO_GLYPH_SCALE)
      .lineWidth(LOGO_GLYPH_STROKE)
      .lineJoin('round')
      .lineCap('round')
      .path(glyph.d)
      .fillAndStroke(color, color)
      .restore();
  }
  document.restore();
}
