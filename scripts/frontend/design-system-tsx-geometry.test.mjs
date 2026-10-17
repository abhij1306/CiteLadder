import assert from 'node:assert/strict';
import { test } from 'node:test';

import { tsxGeometryFindings } from '../../frontend/scripts/design-system-source-checks.mjs';

const feature = 'components/example/view.tsx';
const rules = (source, label = feature) =>
  tsxGeometryFindings(source, label).map(({ rule }) => rule);

test('arbitrary radii are raw, including inside cva recipes and constants', () => {
  assert.deepEqual(rules('const chip = cva("rounded-[6px] px-2", { variants: {} });'), [
    'tsx-radius',
  ]);
  assert.deepEqual(rules('export const frame = "md:rounded-t-[0.75rem]";'), ['tsx-radius']);
  assert.deepEqual(
    rules('<div className="rounded-[var(--radius-card)] rounded-[inherit] rounded-full" />'),
    [],
  );
});

test('literal dimensions belong to components/ui owners', () => {
  assert.deepEqual(rules('<div className="h-[240px] min-w-[32rem]" />'), ['tsx-size', 'tsx-size']);
  assert.deepEqual(rules('<div className="h-[240px]" />', 'components/ui/chart-frame.tsx'), []);
  assert.deepEqual(
    rules('<div className="w-[var(--sidebar-width)] max-w-[60%] h-[calc(100%-var(--x))]" />'),
    [],
  );
});

test('inline style literals are judged by property', () => {
  assert.deepEqual(
    rules(
      '<div style={{ width: 240, color: "#fff", boxShadow: "0 1px 2px black", padding: "6px" }} />',
    ),
    ['tsx-style', 'tsx-style', 'tsx-style', 'tsx-style'],
  );
  assert.deepEqual(
    rules(
      '<div style={{ width: "var(--w)", opacity: 0.5, flex: 1, zIndex: 3, top: 0, boxShadow: "var(--shadow-overlay)" }} />',
    ),
    [],
  );
});

test('Lucide stroke weight is owned by the shared icon rule', () => {
  assert.deepEqual(
    rules('import { Check } from "lucide-react"; const a = <Check strokeWidth={1.5} />;'),
    ['tsx-stroke'],
  );
  assert.deepEqual(rules('<svg className="stroke-[1.5]" />'), ['tsx-stroke']);
  assert.deepEqual(rules('const a = <Ring strokeWidth={4} />;'), []);
});

test('tests and non-TypeScript files are not judged', () => {
  assert.deepEqual(rules('<div className="h-[240px]" />', 'components/x.test.tsx'), []);
});
