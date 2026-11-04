import assert from 'node:assert/strict';
import { test } from 'node:test';

import { headingPunctuationViolations } from '../../frontend/scripts/design-system-copy-checks.mjs';

test('flags headings, component titles and content titles that end in a full stop', () => {
  const source = [
    '<h2 className="x">Everything in one project.</h2>',
    '<SectionHeader title="Keep exploring." />',
    "const post = { title: 'How to audit a site.' };",
  ].join('\n');

  assert.deepEqual(headingPunctuationViolations(source, 'components/projects/page.tsx'), [
    'components/projects/page.tsx:1: heading ends in a full stop: "Everything in one project."',
    'components/projects/page.tsx:2: heading ends in a full stop: "Keep exploring."',
    'components/projects/page.tsx:3: heading ends in a full stop: "How to audit a site."',
  ]);
});

test('leaves questions, ellipses, unpunctuated headings and native tooltips alone', () => {
  const source = [
    '<h2>Questions, answered</h2>',
    '<h3>Why does this matter?</h3>',
    '<h3>Loading...</h3>',
    '<div title="Drag to resize. Double-click to reset." />',
  ].join('\n');

  assert.deepEqual(headingPunctuationViolations(source, 'components/ui/pane.tsx'), []);
});
