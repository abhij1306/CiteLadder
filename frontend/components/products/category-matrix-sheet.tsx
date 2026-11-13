import { useMutation } from '@tanstack/react-query';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { Inline, Stack } from '@/components/ui/layout';
import { MutationNotice } from '@/components/ui/mutation-notice';
import { textRole } from '@/components/ui/typography';
import { ledgerClasses, ledgerItemClasses } from '@/components/ui/workspace';
import { commerceMutations } from '@/lib/api/commerce';
import { mutationNoticeForError } from '@/lib/api/mutation-notice';
import { pluralCount } from '@/lib/format';
import { buyerStageLabels } from '@/lib/prompts/forms';
import { useGenerateBuyerPrompts } from '@/lib/products/use-generate-buyer-prompts';
import { useActiveWorkspaceId, useWorkspaceCapability } from '@/lib/project/project-context';
import type { BuyerPrompt } from '@citeladder/contracts/commerce-suite';

/** What a category's matrix covers: contexts × stages of non-branded prompts, plus branded ones. */
function matrixCoverage(rows: readonly BuyerPrompt[]) {
  const organic = rows.filter((row) => !row.branded && row.context && row.buyer_stage);
  const contexts = [...new Set(organic.map((row) => row.context))];
  const stages = [...new Set(organic.map((row) => row.buyer_stage))];
  return {
    contexts,
    stages,
    organic,
    branded: rows.filter((row) => row.branded),
    other: rows.filter((row) => !row.branded && !(row.context && row.buyer_stage)),
    filledCells: new Set(organic.map((row) => `${row.context}|${row.buyer_stage}`)).size,
  };
}

/**
 * Generates and reviews one category's shopping-prompt matrix. Standalone: the
 * caller owns the open state and passes that category's prompts, so the trigger
 * can live on any screen that names a category.
 */
export function CategoryMatrixSheet({
  projectId,
  categoryId,
  categoryLabel,
  rows,
  open,
  onOpenChange,
}: Readonly<{
  projectId: string;
  categoryId: string;
  categoryLabel: string;
  rows: readonly BuyerPrompt[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}>) {
  const scope = { workspaceId: useActiveWorkspaceId(), projectId };
  const { generate: generateMatrix, mutation: generate } = useGenerateBuyerPrompts(scope);
  const decide = useMutation(commerceMutations.decideBuyerPrompt(scope));
  const coverage = matrixCoverage(rows);
  const busy = generate.isPending || decide.isPending;
  // Generating is a run and approving a write; a role without them reads the matrix.
  const canRun = useWorkspaceCapability('run');
  const canWrite = useWorkspaceCapability('write');
  const toggle = (row: BuyerPrompt) =>
    canWrite ? (
      <Button
        variant={row.enabled ? 'secondary' : 'primary'}
        disabled={busy}
        onClick={() => decide.mutate({ id: row.id, approved: !row.enabled })}
      >
        {row.enabled ? 'Disable' : 'Approve'}
      </Button>
    ) : (
      <Badge>{row.enabled ? 'Approved' : 'Not approved'}</Badge>
    );
  const list = (title: string, items: readonly BuyerPrompt[]) =>
    items.length ? (
      <Stack>
        <h3 className={textRole('itemTitle')}>{title}</h3>
        <ul className={ledgerClasses()}>
          {items.map((row) => (
            <Inline as="li" key={row.id} gap="compact" className={ledgerItemClasses('flex-wrap')}>
              <span className="text-ink-secondary min-w-0 flex-1">
                {row.text}
                {row.context ? (
                  <span className="text-ink-tertiary">
                    {' '}
                    · {row.context}
                    {row.buyer_stage ? `, ${buyerStageLabels[row.buyer_stage]}` : ''}
                  </span>
                ) : null}
              </span>
              {toggle(row)}
            </Inline>
          ))}
        </ul>
      </Stack>
    ) : null;
  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title="Shopping prompts"
      eyebrow={categoryLabel}
      description="One prompt per buyer context and intent stage, plus a few branded comparisons. Generated prompts stay disabled until you approve them."
      footer={
        canRun ? (
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => generateMatrix({ targets: [{ kind: 'category', id: categoryId }] })}
          >
            {generate.isPending ? 'Generating…' : 'Generate matrix'}
          </Button>
        ) : undefined
      }
    >
      <Stack>
        {generate.isError ? (
          <MutationNotice
            notice={mutationNoticeForError(generate.error, { action: 'generate shopping prompts' })}
          />
        ) : null}
        {decide.isError ? (
          <MutationNotice
            notice={mutationNoticeForError(decide.error, { action: 'update the shopping prompt' })}
          />
        ) : null}
        <p aria-label="Matrix coverage" className={textRole('body')}>
          {coverage.contexts.length
            ? `${pluralCount(coverage.contexts.length, 'context')} × ${pluralCount(coverage.stages.length, 'stage')} (${coverage.filledCells} of ${coverage.contexts.length * coverage.stages.length} filled) · ${coverage.branded.length} branded`
            : 'No matrix yet for this category.'}
        </p>
        {list('Buyer contexts × stages', coverage.organic)}
        {list('Branded comparisons', coverage.branded)}
        {list('Other prompts', coverage.other)}
      </Stack>
    </Drawer>
  );
}
