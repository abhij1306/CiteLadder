import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { commentFindings, isCommentChecked } from './source-comments.mjs';

const GIT_EXECUTABLE = '/usr/bin/git';

export function main(cwd = process.cwd()) {
  const root = execFileSync(GIT_EXECUTABLE, ['rev-parse', '--show-toplevel'], {
    cwd,
    encoding: 'utf8',
  }).trim();
  const files = execFileSync(
    GIT_EXECUTABLE,
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    },
  )
    .split('\0')
    .filter((file) => file && isCommentChecked(file) && fs.existsSync(path.join(root, file)));
  const findings = files.flatMap((file) =>
    commentFindings(fs.readFileSync(path.join(root, file), 'utf8'), file),
  );
  if (!findings.length) return 0;
  process.stderr.write(
    [
      `${findings.length} source comment(s). Source code has no comments: carry the meaning in a name, a type or a test, or in the owner doc when it crosses boundaries. Only machine-read directives are allowed (frontend/scripts/source-comments.mjs).`,
      ...findings.map(({ file, line, text }) => `  ${file}:${line}: ${text}`),
      '',
    ].join('\n'),
  );
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename))
  process.exitCode = main();
