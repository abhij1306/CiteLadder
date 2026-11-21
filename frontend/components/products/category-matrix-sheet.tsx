import { useMutation } from '@tanstack/react-query';

import { Tag } from '@/components/ui/tag';
import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { Stack } from '@/components/ui/layout';
import { LedgerItem, LedgerList } from '@/components/ui/ledger-list';
import { textRole } from '@/components/ui/typography';
import { commerceMutations } from '@/lib/api/commerce';
import { mutationNoticeForError } from '@/lib/api/mutation-notice';
import { pluralCount } from '@/lib/format';
import { buyerStageLabels } from '@/lib/prompts/forms';
import { useGenerateBuyerPrompts } from '@/lib/products/use-generate-buyer-prompts';
import { useActiveWorkspaceId, useWorkspaceCapability } from '@/lib/project/project-context';
import type { BuyerPrompt } from '@citeladder/contracts/commerce-suite';
import { Notice } from '@/components/ui/notice';

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
  const canRun = useWorkspaceCapability('run');
  const canWrite = useWorkspaceCapability('write');
  const toggle = (row: BuyerPrompt) =>
    canWrite ? (
      <Button
        variant="secondary"
        disabled={busy}
        onClick={() => decide.mutate({ id: row.id, approved: !row.enabled })}
      >
        {row.enabled ? 'Disable' : 'Approve'}
      </Button>
    ) : (
      <Tag>{row.enabled ? 'Approved' : 'Not approved'}</Tag>
    );
  const list = (title: string, items: readonly BuyerPrompt[]) =>
    items.length ? (
      <Stack>
        <h3 className={textRole('subheading')}>{title}</h3>
        <LedgerList>
          {items.map((row) => (
            <LedgerItem
              key={row.id}
              title={row.text}
              caption={
                row.context
                  ? [row.context, row.buyer_stage && buyerStageLabels[row.buyer_stage]]
                      .filter(Boolean)
                      .join(', ')
                  : undefined
              }
              meta={toggle(row)}
            />
          ))}
        </LedgerList>
      </Stack>
    ) : null;
  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title="Shopping prompts"
      eyebrow={categoryLabel}
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
          <Notice
            kind="mutation"
            notice={mutationNoticeForError(generate.error, { action: 'generate shopping prompts' })}
          />
        ) : null}
        {decide.isError ? (
          <Notice
            kind="mutation"
            notice={mutationNoticeForError(decide.error, { action: 'update the shopping prompt' })}
          />
        ) : null}
        <p aria-label="Matrix coverage" className={textRole('body', 'text-ink-2')}>
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
