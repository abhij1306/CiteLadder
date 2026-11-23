import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';

import { MastheadOverflow, MastheadPrimarySlot } from '@/components/ui/masthead-actions';
import { isTextCut, Tooltip } from '@/components/ui/tooltip';
import { textRole } from '@/components/ui/typography';
import { ChevronRight } from '@/lib/icons';
import { cn } from '@/lib/utils';

export const MASTHEAD_LABELLED = 'shrink-0 justify-start';

export function Masthead({
  title,
  section,
  lead,
  search,
  actions,
  end,
  crumb,
  heading: isHeading = true,
}: Readonly<{
  title: string;
  section?: Readonly<{ title: string }> | null;
  lead?: ReactNode;
  crumb?: ReactNode;
  heading?: boolean;
  search?: ReactNode;
  actions?: ReactNode;
  end?: ReactNode;
}>) {
  const heading = useRef<HTMLHeadingElement>(null);
  const header = useRef<HTMLElement>(null);
  const cut = useIsCut(heading, title);
  const Name = isHeading ? 'h1' : 'p';
  usePublishedHeight(header);
  const [primarySlot, setPrimarySlot] = useState<HTMLElement | null>(null);
  const hasControls = [search, actions, end].some(
    (part) => part !== undefined && part !== null && part !== false,
  );
  return (
    <header
      data-masthead=""
      ref={header}
      className="bg-page border-rule z-sticky rail:h-[var(--masthead-height)] sticky top-0 -mx-[var(--page-pad-inline)] flex min-h-[var(--masthead-height)] min-w-0 items-center gap-2 border-b px-[var(--page-pad-inline)]"
    >
      <div data-masthead-title="" className="rail:min-w-0 me-2 flex flex-1 items-center gap-2">
        {lead}
        {section ? (
          <span
            className={textRole('body', 'text-ink-2 rail:flex hidden shrink-0 items-center gap-2')}
          >
            {section.title}
            <ChevronRight aria-hidden className="size-3" />
          </span>
        ) : null}
        {crumb ?? (
          <Tooltip content={title} side="bottom" describe={false} shouldOpen={isTextCut}>
            <Name
              ref={heading}
              data-masthead-name=""
              tabIndex={cut ? 0 : undefined}
              className={textRole('label', cn('w-0 min-w-28 flex-1 truncate', cut && 'focus-ring'))}
            >
              {title}
            </Name>
          </Tooltip>
        )}
      </div>
      <div
        data-masthead-end=""
        className="flex shrink-0 items-center gap-2 [&_:is(button,a)]:shrink-0"
      >
        {hasControls ? (
          <MastheadPrimarySlot value={primarySlot}>
            <MastheadOverflow>
              {actions}
              {search ? <div className="rail:order-1 flex flex-col">{search}</div> : null}
              {end ? <div className="rail:order-1 flex flex-col">{end}</div> : null}
            </MastheadOverflow>
          </MastheadPrimarySlot>
        ) : null}
        <span ref={setPrimarySlot} data-masthead-primary="" className="contents" />
      </div>
    </header>
  );
}

export function usePublishedHeight(
  ref: RefObject<HTMLElement | null>,
  property = '--masthead-block-size',
) {
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const root = document.documentElement;
    const update = () =>
      root.style.setProperty(property, `${node.getBoundingClientRect().height}px`);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => {
      observer.disconnect();
      root.style.removeProperty(property);
    };
  }, [ref, property]);
}

function useIsCut(ref: RefObject<HTMLElement | null>, text: string) {
  const [cut, setCut] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const update = () => setCut(isTextCut(node));
    update();
    void document.fonts?.ready.then(update);
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref, text]);
  return cut;
}
