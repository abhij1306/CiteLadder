import { Tag } from '@/components/ui/tag';
import { Inline } from '@/components/ui/layout';
import type { ModelProvenance } from '@citeladder/contracts';

export function MeasurementContext({
  provenance,
}: Readonly<{ provenance: readonly ModelProvenance[] }>) {
  const models = distinctModels(provenance);
  return (
    <div data-measurement-context>
      <Inline as="span" className="flex-wrap">
        {models.length > 1 ? (
          <Tag title={models.join(', ')}>Multiple models ({models.length})</Tag>
        ) : (
          <ModelBadge model={models[0] ?? null} />
        )}
      </Inline>
    </div>
  );
}

function ModelBadge({ model }: Readonly<{ model: string | null }>) {
  if (!model) return <Tag>Model not recorded</Tag>;
  return (
    <Tag>
      <span className="tabular-nums">{model}</span>
    </Tag>
  );
}

function distinctModels(provenance: readonly ModelProvenance[]): string[] {
  const seen = new Set<string>();
  for (const entry of provenance) {
    if (entry.transport_model) seen.add(entry.transport_model);
  }
  return [...seen];
}
