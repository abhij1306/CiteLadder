import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';

import { isTextCut, Tooltip } from '@/components/ui/tooltip';
import { textRole } from '@/components/ui/typography';
import { cn } from '@/lib/utils';

/**
 * The top-bar rule and fill: a layer behind the header as wide as the main
 * column (its size container plus both gutters), so content scrolling under
 * the bar never shows beside it and the rule meets the sidebar's.
 */
const BAR_LAYER =
  'before:bg-paper before:border-line before:absolute before:inset-y-0 before:left-1/2 before:-z-10 before:w-[calc(100cqw+2*var(--content-gutter))] before:-translate-x-1/2 before:border-b';

/**
 * PageHeader — the top of every app page and its half of the app's sticky
 * top bar (decision D12): the page name in `type-page-title` (20/28,
 * decision D58) and the page's actions on the right (secondary first, then the one
 * primary), on one `row-app` row with space-2 above and below and a 1px
 * `line` rule under it, level with the sidebar's project switcher. A detail
 * page leads the title with its way back.
 *
 * Only where the actions cannot fit beside the title (a phone) do they take
 * a second row. The title is always one line (owner: a header never takes
 * two rows): a longer name is cut with an ellipsis, and only then does the
 * title take keyboard focus and show the full name in the shared tooltip on
 * hover and focus. Its accessible name is always the full name.
 */
export function PageHeader({
  title,
  lead,
  filters,
  center,
  actions,
}: Readonly<{
  title: string;
  /**
   * The bar's middle from 900px: the shell's search (D62). The title and the
   * actions then share the rest equally, so it sits on the bar's centre.
   */
  center?: ReactNode;
  /** Before the title: a detail page's back button. */
  lead?: ReactNode;
  /**
   * After the title: a page's filters when they are its only controls (D58),
   * on the title's side so their menus open toward the content.
   */
  filters?: ReactNode;
  actions?: ReactNode;
}>) {
  const heading = useRef<HTMLHeadingElement>(null);
  const cut = useIsCut(heading, title);
  return (
    <header
      data-page-header=""
      data-page-band="identity"
      className={cn(
        BAR_LAYER,
        'sticky top-0 z-20 isolate flex min-h-[var(--page-header-band)] min-w-0 flex-wrap items-center justify-between gap-x-[var(--card-padding)] gap-y-2 py-2',
      )}
    >
      <div className="flex min-h-[var(--row-app)] min-w-[min(100%,12rem)] flex-1 items-center gap-3">
        {lead}
        <Tooltip content={title} side="bottom" describe={false} shouldOpen={isTextCut}>
          <h1
            ref={heading}
            // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Only a cut title takes focus, so a keyboard reader can open the tooltip holding the full name.
            tabIndex={cut ? 0 : undefined}
            className={textRole('pageTitle', cn('min-w-0 truncate', cut && 'focus-ring'))}
          >
            {title}
          </h1>
        </Tooltip>
        {filters ? <div className="flex shrink-0 items-center">{filters}</div> : null}
      </div>
      {/* The search takes the free width first, up to 320; the sides then share
          the rest equally. The actions never go under their own width, so a
          crowded bar narrows the search rather than wrapping. */}
      {center ? (
        <div className="rail:flex hidden max-w-80 min-w-0 grow-[999] basis-32">{center}</div>
      ) : null}
      {actions ? (
        <div
          className={cn(
            'ms-auto flex min-w-0 flex-wrap items-center justify-end gap-2',
            center && 'rail:min-w-max rail:flex-1 rail:basis-0 rail:flex-nowrap',
          )}
        >
          {actions}
        </div>
      ) : null}
    </header>
  );
}

/**
 * Whether the element is cutting its text, kept current as it resizes, so a
 * cut title (and only a cut one) can take focus to reveal its tooltip.
 */
function useIsCut(ref: RefObject<HTMLElement | null>, text: string) {
  const [cut, setCut] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const update = () => setCut(isTextCut(node));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref, text]);
  return cut;
}
