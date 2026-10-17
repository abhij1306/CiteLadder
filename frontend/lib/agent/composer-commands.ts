/**
 * Composer commands: `/` picks a skill and `@` mentions an Action, both typed
 * inline. A command token starts at the beginning of the message or after
 * whitespace and runs to the caret; picking an option replaces the token.
 */

type CommandTrigger = '/' | '@';

export type CommandToken = { trigger: CommandTrigger; query: string; start: number; end: number };

export type CommandOption = {
  key: string;
  label: string;
  detail?: string;
  /** Text that replaces the token; empty removes it. */
  replacement: string;
};

/** Options one command menu shows at most. */
const COMMAND_OPTIONS_MAX = 6;

const TOKEN = /(^|\s)([/@])([^\s/@]{0,40})$/;

export function tokenAt(text: string, caret: number): CommandToken | null {
  const match = TOKEN.exec(text.slice(0, caret));
  if (!match) return null;
  // Every group takes part in a match; the lead and query may be empty.
  const [, lead = '', trigger, query = ''] = match;
  return {
    trigger: trigger === '@' ? '@' : '/',
    query,
    start: match.index + lead.length,
    end: caret,
  };
}

/** The message with the token replaced, and where the caret lands. */
export function applyOption(
  text: string,
  token: CommandToken,
  option: CommandOption,
): { text: string; caret: number } {
  const before = text.slice(0, token.start);
  const after = text.slice(token.end).replace(/^ /, '');
  const insert = option.replacement ? `${option.replacement} ` : '';
  return { text: before + insert + after, caret: before.length + insert.length };
}

/** Options whose label contains every word of the query, case-insensitively. */
export function matchOptions(options: readonly CommandOption[], query: string): CommandOption[] {
  const words = query
    .toLowerCase()
    .split(/[\s_-]+/)
    .filter(Boolean);
  return options
    .filter((option) => {
      const haystack = `${option.label} ${option.detail ?? ''}`.toLowerCase();
      return words.every((word) => haystack.includes(word));
    })
    .slice(0, COMMAND_OPTIONS_MAX);
}
