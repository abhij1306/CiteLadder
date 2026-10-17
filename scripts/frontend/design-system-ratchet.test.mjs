import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  ratchetVerdict,
  readBaseline,
  writeBaseline,
} from '../../frontend/scripts/design-system-ratchet.mjs';

const finding = (file, rule, line = 1) => ({ file, rule, line, message: 'example' });

test('the ratchet allows a fall, rejects a rise and treats unknown files as zero', () => {
  const baseline = { files: { 'a.css': { 'css-radius': 2 } } };

  const fallen = ratchetVerdict([finding('a.css', 'css-radius')], baseline);
  assert.deepEqual(fallen.violations, []);
  assert.equal(fallen.lowered.length, 1);

  const steady = ratchetVerdict(
    [finding('a.css', 'css-radius', 1), finding('a.css', 'css-radius', 9)],
    baseline,
  );
  assert.deepEqual(steady, { violations: [], lowered: [] });

  const risen = ratchetVerdict(
    [1, 2, 3].map((line) => finding('a.css', 'css-radius', line)),
    baseline,
  );
  assert.ok(risen.violations[0].includes('rose from 2 to 3'));

  const fresh = ratchetVerdict([finding('b.css', 'css-radius')], baseline);
  assert.ok(fresh.violations[0].includes('b.css: css-radius rose from 0 to 1'));
  // A new rule in a baselined file starts at zero too.
  assert.equal(ratchetVerdict([finding('a.css', 'css-type')], baseline).violations.length, 2);
});

test('a written baseline accepts exactly the findings it recorded', () => {
  const directory = mkdtempSync(join(tmpdir(), 'citeladder-ratchet-'));
  try {
    const path = join(directory, 'baseline.json');
    const findings = [finding('a.css', 'css-radius'), finding('a.css', 'css-type')];
    writeBaseline(path, findings);
    const baseline = readBaseline(path);
    assert.deepEqual(ratchetVerdict(findings, baseline), { violations: [], lowered: [] });
    assert.equal(
      ratchetVerdict([...findings, finding('a.css', 'css-type', 4)], baseline).violations.length,
      3,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
