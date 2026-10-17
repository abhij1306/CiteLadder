/**
 * The Overview widget catalog and the edits a layout allows. Each edit returns
 * a new widget list; the caller saves it against the layout's version.
 */
import {
  overviewWidgetKeySchema,
  type OverviewWidget,
  type OverviewWidgetKey,
} from '@citeladder/contracts/overview';

export const WIDGET_TITLES: Record<OverviewWidgetKey, string> = {
  project_state: 'Project state',
  citation_share: 'Citation share',
  movement: 'Movement',
  next_action: 'Next action',
  missing_prompts: "Where you're missing",
  ranked_actions: 'Ranked actions',
  progress_proof: 'Progress and report proof',
  company_facts: 'Company facts',
  visibility_trend: 'Visibility over time',
  share_of_voice: 'Share of voice',
  top_movers: 'Top movers',
  retrieval: 'Retrieved versus cited',
  perception: 'Perception',
  ai_traffic: 'AI Traffic',
  search_console: 'Search Console',
};

/** Widgets the layout does not show yet, in catalog order. */
export function addableWidgets(widgets: readonly OverviewWidget[]): OverviewWidgetKey[] {
  const shown = new Set(widgets.map((widget) => widget.key));
  return overviewWidgetKeySchema.options.filter((key) => !shown.has(key));
}

export function addWidget(widgets: readonly OverviewWidget[], key: OverviewWidgetKey) {
  return widgets.some((widget) => widget.key === key)
    ? [...widgets]
    : [...widgets, { key, size: 'half' as const }];
}

/** The last widget stays: an Overview with nothing on it is not a layout. */
export function removeWidget(widgets: readonly OverviewWidget[], index: number) {
  return widgets.length > 1 ? widgets.filter((_, position) => position !== index) : [...widgets];
}

export function moveWidget(widgets: readonly OverviewWidget[], from: number, to: number) {
  if (from === to || to < 0 || to >= widgets.length || !widgets[from]) return [...widgets];
  const next = [...widgets];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}

export function toggleWidth(widgets: readonly OverviewWidget[], index: number) {
  return widgets.map((widget, position) =>
    position === index
      ? { ...widget, size: widget.size === 'half' ? ('full' as const) : ('half' as const) }
      : widget,
  );
}
