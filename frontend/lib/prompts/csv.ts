/**
 * In-browser CSV parsing for the prompt library bulk import.
 *
 * The CSV is parsed and validated entirely in the browser so the user can
 * preview + fix rows before anything is persisted; the accepted rows are then
 * posted as rows to the `/prompt-sets/{id}/import` endpoint, which accepts
 * only parsed rows, so this module is the one CSV reader.
 *
 * Users supply only `topic` and `prompt` ({@link PROMPT_CSV_COLUMNS}, which the
 * downloadable sample is also built from). Theme, intent, buyer stage,
 * persona, cohort and enabled remain optional columns: unknown or oversized
 * values fall back to code defaults and never produce a row error.
 *
 * A tiny hand-rolled parser (no dependency) handles quoted fields, escaped
 * quotes (`""`), and embedded newlines — enough for prompt CSVs.
 */
import type { PromptImportRow } from '@/lib/api/prompts';
import { buyerStageSchema, promptIntentSchema } from '@citeladder/contracts/project';
import type { BuyerStage, PromptIntent } from '@/lib/api/types';
import { PERSONA_MAX_CHARS, PROMPT_IMPORT_MAX_ROWS } from '@/lib/config/prompts';

/** The import's column contract, in the order the sample file uses. */
export const PROMPT_CSV_COLUMNS = ['topic', 'prompt'] as const;

/** Sample rows for the downloadable template, one cell per contract column. */
export const PROMPT_CSV_SAMPLE_ROWS: readonly (readonly [string, string])[] = [
  ['Running shoes', 'What are the best running shoes for flat feet?'],
  ['Running shoes', 'Which running shoe brands last the longest?'],
  ['Trail gear', 'What should I pack for a first trail marathon?'],
  ['', 'Where can I get my running gait analysed?'],
];

type PromptCsvColumn = (typeof PROMPT_CSV_COLUMNS)[number];

// Header aliases per column; each contract column's own name comes first.
const COLUMN_KEYS: Record<PromptCsvColumn, ReadonlySet<string>> = {
  topic: new Set(['topic', 'category']),
  prompt: new Set(['prompt', 'text', 'query', 'question']),
};
const THEME_KEYS = new Set(['theme']);
const INTENT_KEYS = new Set(['intent']);
const STAGE_KEYS = new Set(['buyer_stage', 'buyer stage', 'stage']);
const PERSONA_KEYS = new Set(['persona', 'audience']);
const COHORT_KEYS = new Set(['cohort']);
const ENABLED_KEYS = new Set(['enabled', 'is_enabled', 'active']);

/** API prompt-library bounds, counted in code points. */
const PROMPT_MAX_CHARS = 300;
const TOPIC_MAX_CHARS = 255;
const THEME_MAX_CHARS = 255;

const codePoints = (value: string) => Array.from(value);

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'y', 't']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'n', 'f']);

const VALID_INTENTS = new Set<string>(promptIntentSchema.options);
const VALID_STAGES = new Set<string>(buyerStageSchema.options);

type ParsedPromptRow = {
  /** 1-based source row number (excludes the header) for user feedback. */
  line: number;
  input: PromptImportRow;
  /** Fatal issues (row is not importable, e.g. empty prompt). */
  errors: string[];
};

export type ParsedCsv = {
  rows: ParsedPromptRow[];
  /** True when the file had a recognizable header row. */
  hasHeader: boolean;
  /** File-level errors (empty file, no data rows). */
  errors: string[];
};

type CsvState = {
  rows: string[][];
  field: string;
  row: string[];
  inQuotes: boolean;
};

function pushField(state: CsvState): void {
  state.row.push(state.field);
  state.field = '';
}

function pushRow(state: CsvState): void {
  pushField(state);
  state.rows.push(state.row);
  state.row = [];
}

function consumeQuotedCharacter(state: CsvState, text: string, index: number): number {
  if (text[index] !== '"') {
    state.field += text[index];
    return index;
  }
  if (text[index + 1] === '"') {
    state.field += '"';
    return index + 1;
  }
  state.inQuotes = false;
  return index;
}

function consumePlainCharacter(state: CsvState, text: string, index: number): number {
  const char = text[index];
  if (char === '"') state.inQuotes = true;
  else if (char === ',') pushField(state);
  else if (char === '\n' || char === '\r') {
    pushRow(state);
    return char === '\r' && text[index + 1] === '\n' ? index + 1 : index;
  } else state.field += char;
  return index;
}

/** Tokenize CSV text into a matrix of string cells (RFC-4180-ish). */
export function tokenizeCsv(raw: string): string[][] {
  const text = raw.codePointAt(0) === 0xfeff ? raw.slice(1) : raw;
  const state: CsvState = { rows: [], field: '', row: [], inQuotes: false };

  // Each consumer returns the last index it used, which may skip a paired
  // character (an escaped quote or the \n of \r\n).
  let index = 0;
  while (index < text.length) {
    const consumed = state.inQuotes
      ? consumeQuotedCharacter(state, text, index)
      : consumePlainCharacter(state, text, index);
    index = consumed + 1;
  }
  if (state.field.length > 0 || state.row.length > 0) pushRow(state);
  return state.rows.filter((cells) => cells.some((cell) => cell.trim() !== ''));
}

function asBool(value: string | undefined, fallback: boolean): boolean {
  const normalized = (value ?? '').trim().toLowerCase();
  if (!normalized) return fallback;
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;
  return fallback;
}

/** An unknown intent is internal vocabulary gone stale: it defaults silently. */
function normalizeIntent(value: string | undefined): PromptIntent {
  const normalized = (value ?? '').trim().toLowerCase();
  return VALID_INTENTS.has(normalized) ? (normalized as PromptIntent) : '';
}

/** An unknown buyer stage is left unset, like an unknown intent. */
function normalizeStage(value: string | undefined): BuyerStage {
  const normalized = (value ?? '').trim().toLowerCase();
  return VALID_STAGES.has(normalized) ? (normalized as BuyerStage) : '';
}

/** An explicit cohort is kept; a blank or missing one is left to the backend. */
function cohortOf(value: string | undefined): Pick<PromptImportRow, 'cohort'> {
  const normalized = (value ?? '').trim().toLowerCase();
  if (normalized === 'comparison') return { cohort: 'comparison' };
  return normalized === 'core' ? { cohort: 'core' } : {};
}

type ColumnMap = {
  text: number;
  topic: number;
  theme: number;
  intent: number;
  stage: number;
  persona: number;
  cohort: number;
  enabled: number;
};

function detectColumns(headerCells: string[]): ColumnMap | null {
  const find = (keys: ReadonlySet<string>) =>
    headerCells.findIndex((cell) => keys.has(cell.trim().toLowerCase()));
  const map: ColumnMap = {
    text: find(COLUMN_KEYS.prompt),
    topic: find(COLUMN_KEYS.topic),
    theme: find(THEME_KEYS),
    intent: find(INTENT_KEYS),
    stage: find(STAGE_KEYS),
    persona: find(PERSONA_KEYS),
    cohort: find(COHORT_KEYS),
    enabled: find(ENABLED_KEYS),
  };
  // A header row is recognized only if it names at least the prompt column.
  return map.text >= 0 ? map : null;
}

/** Without a header, the first column is the prompt text (as on the server). */
const HEADERLESS_COLUMNS: ColumnMap = {
  text: 0,
  topic: -1,
  theme: -1,
  intent: -1,
  stage: -1,
  persona: -1,
  cohort: -1,
  enabled: -1,
};

function parseRow(cells: string[], map: ColumnMap, line: number): ParsedPromptRow {
  const cell = (col: number) => (col >= 0 ? cells[col] : undefined);
  const text = (cell(map.text) ?? '').trim();
  const topic = (cell(map.topic) ?? '').trim();
  const errors: string[] = [];
  if (!text) errors.push('Prompt is required.');
  if (codePoints(text).length > PROMPT_MAX_CHARS) errors.push('Prompt is too long.');
  if (codePoints(topic).length > TOPIC_MAX_CHARS) errors.push('Topic name is too long.');
  return {
    line,
    input: {
      text,
      topic,
      // Backend `PromptInput.theme` is a non-null string; send '' (not null)
      // when the column is blank so the import never 422s.
      theme: codePoints((cell(map.theme) ?? '').trim())
        .slice(0, THEME_MAX_CHARS)
        .join(''),
      intent: normalizeIntent(cell(map.intent)),
      buyer_stage: normalizeStage(cell(map.stage)),
      persona: codePoints((cell(map.persona) ?? '').trim())
        .slice(0, PERSONA_MAX_CHARS)
        .join(''),
      // No cohort column leaves filing to the backend, which files a prompt
      // naming the brand as branded.
      ...cohortOf(cell(map.cohort)),
      enabled: asBool(cell(map.enabled), true),
    },
    errors,
  };
}

/**
 * Parse CSV text into previewable prompt rows. With a header row, columns are
 * matched by name (any order); without one, the first column is the prompt.
 */
export function parsePromptCsv(raw: string): ParsedCsv {
  const matrix = tokenizeCsv(raw);
  const [firstRow] = matrix;
  if (!firstRow) {
    return { rows: [], hasHeader: false, errors: ['The file is empty.'] };
  }

  const columns = detectColumns(firstRow);
  const hasHeader = columns !== null;
  const dataRows = hasHeader ? matrix.slice(1) : matrix;
  const rows = dataRows.map((cells, index) =>
    parseRow(cells, columns ?? HEADERLESS_COLUMNS, index + 1),
  );

  const errors: string[] = [];
  if (rows.length === 0) errors.push('No data rows were found.');
  // The API rejects an oversized upload whole; say so before the preview reads as ready.
  if (rows.length > PROMPT_IMPORT_MAX_ROWS)
    errors.push(
      `The file has ${rows.length} rows; import up to ${PROMPT_IMPORT_MAX_ROWS} at a time by splitting it.`,
    );

  return { rows, hasHeader, errors };
}

/** The importable subset (rows without fatal errors). */
export function validRows(parsed: ParsedCsv): PromptImportRow[] {
  return parsed.rows.flatMap((row) => (row.errors.length === 0 ? [row.input] : []));
}
