import { cn } from '@/lib/utils';

/**
 * Panel — a box that groups part of a page: evidence, a payload, a quoted
 * source, a form's fieldset, a summary.
 *
 * Twenty-seven places used to build this by hand, each picking its own fill,
 * border colour, radius and padding, which is why the same evidence box looked
 * different in six screens. This is a class recipe, not a component, because
 * these boxes land on `div`, `li`, `section`, `fieldset` and `dd` alike and the
 * element must stay semantic.
 *
 * The box takes its fill from where it sits (D51, after Carbon's contextual
 * layers), so it is never a box drawn inside a box: on the page ground it is a
 * container (`surface` with a 1px `line` border, like a Card); inside a card,
 * panel, dialog or drawer it is the inset (`surface-sunken`, its border
 * transparent so the geometry stays one pixel). `radius-lg` and `card-padding`
 * either way; there is no tone, padding, radius or edge variant.
 */
export function panelClasses(className?: string) {
  return cn(
    // `surface-panel` marks a container, so what nests inside it (a table, a
    // query state, another inset) shares it rather than drawing a second edge;
    // `surface-inset` picks the fill by context (globals.css).
    'surface-panel surface-inset rounded-lg border p-[var(--card-padding)]',
    className,
  );
}
