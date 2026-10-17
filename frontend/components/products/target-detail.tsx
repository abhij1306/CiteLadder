'use client';

import { useState } from 'react';

import { BusyBar } from '@/components/ui/busy-bar';
import type { CommerceTarget } from '@citeladder/contracts/commerce-suite';
import type { useCompetitorDiscovery } from '@/lib/products/competitor-discovery';

import type { CommerceQueries } from './commerce-queries';
import { TargetCompetitors } from './target-competitors';
import { TargetPrompts } from './target-prompts';
import { TargetNextStep } from './target-next-step';
import { TargetShelfBand } from './target-shelf-band';
import { TargetShelfEvidence } from './target-shelf-evidence';
import { sameTarget, targetKey } from '@/lib/products/use-commerce-target';
import { Stack } from '@/components/ui/layout';

type ShownTarget = Readonly<{
  target: CommerceTarget;
  label: string;
  shelf: CommerceQueries['shelf'];
}>;

/**
 * Holds the previously selected target's detail on screen until the newly
 * clicked one's shelf metrics land.
 *
 * Shelf is the only Commerce read keyed by the selection — catalog,
 * competitors, and buyer prompts already cover the whole project and just
 * re-filter, so they have nothing to wait for. Switching those the instant a
 * row is clicked, while shelf is still fetching the new target, would print a
 * competitor and prompt list already re-filtered to product B underneath
 * shelf numbers still labelled for product A once they resolve out of order —
 * the same "one item's heading over another item's content" problem Site
 * Health's issue rail solves by holding its header and occurrences together.
 * Holding all three here does the equivalent for three cards instead of one:
 * the panel stays on the previous target, marked busy, until the new
 * target's shelf read settles, then it swaps as one piece. `shelf.isPending`
 * is reliable for this because the shelf query key encodes the target, so
 * TanStack resets it to pending on every new target and never carries a
 * settled flag over from the one before.
 *
 * State, not a ref: React re-runs a component immediately when it is told to
 * update state mid-render, so the swap lands in the same pass rather than
 * lagging a tick behind a `useEffect`, and the held value stays part of the
 * render React knows about instead of a mutation it cannot see.
 */
function useShownTarget(
  target: CommerceTarget,
  label: string,
  shelf: CommerceQueries['shelf'],
): ShownTarget {
  const [shown, setShown] = useState<ShownTarget>({ target, label, shelf });
  const behindSelection =
    shown.target.kind !== target.kind || shown.target.id !== target.id || shown.shelf !== shelf;
  if (!shelf.isPending && behindSelection) setShown({ target, label, shelf });
  return shown;
}

/**
 * Everything about ONE target, in the order it is asked about.
 *
 * Shelf metrics are the outcome and lead; the competitors and prompts that
 * produced them sit beneath. Each of these was a separate tab with its own
 * copy of the target selector, so a merchandiser could never see a category's
 * position and the competitors on that position at the same time.
 */
export function TargetDetail({
  projectId,
  target,
  label,
  queries,
  discovery,
}: Readonly<{
  projectId: string;
  target: CommerceTarget;
  label: string;
  queries: CommerceQueries;
  discovery: ReturnType<typeof useCompetitorDiscovery>;
}>) {
  const shown = useShownTarget(target, label, queries.shelf);
  return (
    <Stack gap="workspace" className="relative content-start" aria-busy={queries.shelf.isFetching}>
      <BusyBar active={queries.shelf.isFetching} label="Updating target detail" />
      <TargetShelfBand query={shown.shelf} />
      {shown.shelf.data ? (
        <>
          {/* A pending or failed read is not an empty list: no advice from it. */}
          {queries.competitors.isSuccess && queries.buyerPrompts.isSuccess ? (
            <TargetNextStep
              kind={shown.target.kind}
              competitors={(queries.competitors.data ?? []).filter((row) =>
                sameTarget({ kind: row.target_kind, id: row.target_id }, shown.target),
              )}
              prompts={(queries.buyerPrompts.data ?? []).filter((row) =>
                sameTarget(row.target, shown.target),
              )}
              shelf={shown.shelf.data}
            />
          ) : null}
          <TargetShelfEvidence shelf={shown.shelf.data} />
        </>
      ) : null}
      <TargetCompetitors
        projectId={projectId}
        target={shown.target}
        query={queries.competitors}
        discovery={discovery}
      />
      <TargetPrompts
        // Typed text and launch state belong to one target, not the next.
        key={targetKey(shown.target)}
        projectId={projectId}
        target={shown.target}
        targetLabel={shown.label}
        query={queries.buyerPrompts}
      />
    </Stack>
  );
}
