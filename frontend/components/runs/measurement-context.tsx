import { Badge } from '@/components/ui/badge';
import type { ModelProvenance } from '@/lib/api/types';

/**
 * The measurement conditions behind a figure: model and retrieval.
 *
 * Two shapes, deliberately distinct:
 *
 *   - a SINGULAR surface (one execution) names the one exact model that
 *     produced it;
 *   - an AGGREGATE spanning several models says "Multiple models" and lists
 *     them, and never elects one to stand in for the rest. Picking a
 *     representative model would attribute every number in the aggregate to a
 *     model that produced only some of them.
 *
 * `null` retrieval means the run predates the frozen policy block. That is
 * "unrecorded", not "off", so it renders as neither.
 */
export function MeasurementContext({
  retrieval,
  model,
  provenance,
  className,
}: Readonly<{
  retrieval?: boolean | null;
  /** The exact model, for a singular-model surface. */
  model?: string | null;
  /** Every measured route, for an aggregate surface. */
  provenance?: readonly ModelProvenance[];
  className?: string;
}>) {
  const models = provenance ? distinctModels(provenance) : [];
  const aggregate = models.length > 1;

  return (
    <div className={className} data-measurement-context>
      <span className="flex flex-wrap items-center gap-2">
        {aggregate ? (
          <Badge variant="neutral" title={models.join(', ')}>
            Multiple models ({models.length})
          </Badge>
        ) : (
          <ModelBadge model={model ?? models[0] ?? null} />
        )}

        {retrieval === null || retrieval === undefined ? null : (
          <Badge variant="neutral">{retrieval ? 'Retrieval on' : 'Retrieval off'}</Badge>
        )}
      </span>
    </div>
  );
}

function ModelBadge({ model }: Readonly<{ model: string | null }>) {
  if (!model) return <Badge variant="neutral">Model not recorded</Badge>;
  return (
    <Badge variant="neutral">
      <span className="tabular-nums">{model}</span>
    </Badge>
  );
}

function distinctModels(provenance: readonly ModelProvenance[]): string[] {
  const seen = new Set<string>();
  for (const entry of provenance) {
    if (entry.transport_model) seen.add(entry.transport_model);
  }
  return [...seen];
}
