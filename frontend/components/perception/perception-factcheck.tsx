import type { AccuracyResponse } from '@citeladder/contracts/fact-checking';
import { useState } from 'react';

import { ClaimsOverTime } from '@/components/perception/claims-over-time';
import { ClaimsTable } from '@/components/perception/claims-table';
import { FactsImportDialog } from '@/components/perception/facts-import-dialog';
import { FactsTable } from '@/components/perception/facts-table';
import { Button, buttonClasses } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { useToast } from '@/components/ui/toast';
import { Download, Upload } from '@/lib/icons';
import { humanizeApiError } from '@/lib/api/errors';
import { Inline } from '@/components/ui/layout';
import { ProjectLink } from '@/components/ui/project-link';
import { textRole } from '@/components/ui/typography';
import { AnalysisRead } from '@/components/visibility/selection-gate';
import { AccuracyView } from '@/components/visibility/visibility-accuracy';
import type { useAccuracy, useFactViews } from '@/lib/visibility/use-accuracy';

type FactViews = ReturnType<typeof useFactViews>;

export function PerceptionFactChecking({
  query,
  views,
}: Readonly<{ query: ReturnType<typeof useAccuracy>; views: FactViews }>) {
  return (
    <AnalysisRead
      query={query}
      title="Couldn't load the fact checks"
      busyLabel="Updating fact checks"
      busy={query.isFetching}
      ready={query.data}
    >
      {(data) => (
        <AccuracyView
          data={data}
          lede={<FactCheckingLede data={data} exporting={views.exporting} />}
          stateActions={<FactActions claims={false} exporting={views.exporting} />}
          trend={<ClaimsOverTime trend={data.trend} />}
          allClaims={<ClaimsTable views={views} />}
          byFact={<FactsTable query={views.facts} />}
        />
      )}
    </AnalysisRead>
  );
}

function contradictedHeadline(count: number) {
  if (count === 0) return 'Your facts contradict no claim AI made';
  return `Your facts contradict ${count} ${count === 1 ? 'claim' : 'claims'} AI made`;
}

function FactCheckingLede({
  data,
  exporting,
}: Readonly<{ data: AccuracyResponse; exporting: FactViews['exporting'] }>) {
  return (
    <Inline className="items-start justify-between">
      <h2 className={textRole('heading')}>
        {contradictedHeadline(data.score.coverage.contradicted)}
      </h2>
      <FactActions claims={data.score.coverage.claims > 0} exporting={exporting} />
    </Inline>
  );
}

function FactActions({
  claims,
  exporting,
}: Readonly<{ claims: boolean; exporting: FactViews['exporting'] }>) {
  const { notify } = useToast();
  const [importing, setImporting] = useState(false);
  return (
    <Inline gap="item" className="shrink-0">
      <ProjectLink href="/agent/context?tab=brand-facts" className={buttonClasses('secondary')}>
        Edit facts
      </ProjectLink>
      <Button variant="secondary" onClick={() => setImporting(true)}>
        <Icon icon={Upload} />
        Import facts CSV
      </Button>
      <FactsImportDialog open={importing} onOpenChange={setImporting} />
      {claims ? (
        <Button
          variant="secondary"
          pending={exporting.isPending}
          onClick={() =>
            exporting.mutate(undefined, {
              onError: (error) =>
                notify("Couldn't export the claims", humanizeApiError(error).message, {
                  tone: 'negative',
                }),
            })
          }
        >
          <Icon icon={Download} />
          Export claims CSV
        </Button>
      ) : null}
    </Inline>
  );
}
