/** Write a generated, formatted public template, or with `--check` fail when the committed one is stale. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { format } from 'vite-plus/fmt';
import { fmtConfig } from '../../../vp-shared-config.ts';

const directory = new URL('../../../public/templates/', import.meta.url);

export async function writeTemplate(name: string, source: string, command: string) {
  const path = new URL(name, directory);
  // The committed template passes the repository formatter, so the generator emits
  // formatted code and the check compares like with like.
  const { ignorePatterns: _ignored, ...formatOptions } = fmtConfig;
  const formatted = await format(path.pathname, source, formatOptions);
  if (formatted.errors.length) throw new Error(`${name} does not parse`);
  const contents = formatted.code;
  if (process.argv.includes('--check')) {
    // A checkout may convert line endings; the template's text is what must match.
    const current = await readFile(path, 'utf8').catch(() => '');
    if (current.replaceAll('\r\n', '\n') !== contents)
      throw new Error(`${name} is stale; run pnpm --filter @citeladder/api ${command}`);
  } else {
    await mkdir(directory, { recursive: true });
    await writeFile(path, contents);
  }
}
