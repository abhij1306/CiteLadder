import { Stack } from '@/components/ui/layout';
import { TextLineSkeleton } from '@/components/ui/loading-parts';
import { Section, SectionHeader } from '@/components/ui/section';
import { FigureBlocks, SkeletonBlock, SkeletonFrame } from '@/components/ui/skeleton-block';
import { ToolbarTableLoading } from '@/components/ui/table-loading';
import { ROWS_SHELL } from '@/components/ui/work-rows';
import { cn } from '@/lib/utils';

export function IssuesSummaryLoading() {
  return (
    <SkeletonFrame label="Loading the issue summary" variant="summary">
      <Stack gap="workspace" className="min-w-0">
        <FigureBlocks count={6} />
        <Section>
          <SectionHeader>
            <TextLineSkeleton text="heading" width="short" />
          </SectionHeader>
          <span aria-hidden className={cn(ROWS_SHELL, 'divide-rule grid divide-y')}>
            {[0, 1, 2].map((row) => (
              <span key={row} className="flex h-10 items-center px-4">
                <SkeletonBlock className="h-4 w-3/5" />
              </span>
            ))}
          </span>
        </Section>
      </Stack>
    </SkeletonFrame>
  );
}

export function IssuesPageLoading() {
  return (
    <>
      <IssuesSummaryLoading />
      <ToolbarTableLoading label="Loading issues" columns={4} rows={8} view />
    </>
  );
}
