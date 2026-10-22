import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  featureLayeringFindings,
  tsxGeometryFindings,
} from '../../frontend/scripts/design-system-source-checks.mjs';

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

const layering = (source, label = feature) =>
  featureLayeringFindings(source, label).map(({ rule, message }) => `${rule}: ${message}`);

test('a feature folder carries no geometry, sizes or breakpoints of its own', () => {
  assert.deepEqual(
    layering(
      '<div className="grid gap-2 p-4 desktop:px-3 rounded-full h-8 w-full min-w-0 flex">' +
        '<Spinner size="sm" /><Box padding="lg" /></div>',
    ),
    [
      'layer-geometry: gap-2 — geometry belongs to a components/ui organism',
      'layer-geometry: p-4 — geometry belongs to a components/ui organism',
      'layer-geometry: desktop:px-3 — geometry belongs to a components/ui organism',
      'layer-geometry: rounded-full — geometry belongs to a components/ui organism',
      'layer-geometry: h-8 — geometry belongs to a components/ui organism',
      'layer-size-prop: size= — atoms have one form; a feature never picks a size',
      'layer-size-prop: padding= — atoms have one form; a feature never picks a size',
    ],
  );
});

test('the product has one breakpoint, desktop:, in ui and layout too', () => {
  const tokens = 'sm:grid-cols-2 max-[700px]:hidden lg:[&>li]:block desktop:grid-cols-2';
  assert.deepEqual(layering(`<div className="${tokens}" />`, 'components/ui/stat.tsx'), [
    "layer-breakpoint: sm:grid-cols-2 — the product's one breakpoint is desktop:",
    "layer-breakpoint: max-[700px]:hidden — the product's one breakpoint is desktop:",
    "layer-breakpoint: lg:[&>li]:block — the product's one breakpoint is desktop:",
  ]);
});

test('owners keep their geometry and public surfaces keep their ladder', () => {
  const source = '<div className="gap-2 p-4 md:grid-cols-2" />';
  assert.deepEqual(layering(source, 'components/ui/card.tsx'), [
    "layer-breakpoint: md:grid-cols-2 — the product's one breakpoint is desktop:",
  ]);
  assert.deepEqual(layering(source, 'components/marketing/hero.tsx'), []);
  assert.deepEqual(layering(source, 'components/auth/sign-in.tsx'), [
    'layer-geometry: gap-2 — geometry belongs to a components/ui organism',
    'layer-geometry: p-4 — geometry belongs to a components/ui organism',
  ]);
  assert.deepEqual(layering(source, 'components/example/view.test.tsx'), []);
});
