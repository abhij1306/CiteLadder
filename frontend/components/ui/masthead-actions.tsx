import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

import { MoreHorizontal } from '@/lib/icons';
import { IconButton } from '@/components/ui/button';
import {
  Menu,
  MenuContent,
  MenuFold,
  MenuItem,
  MenuNested,
  MenuSub,
  MenuSubTrigger,
  MenuTrigger,
} from '@/components/ui/menu';

export const MastheadPrimarySlot = createContext<HTMLElement | null | undefined>(undefined);

export function MastheadPrimary({ children }: Readonly<{ children: ReactNode }>) {
  const slot = useContext(MastheadPrimarySlot);
  const demoted = useContext(PageEmptyOffer)?.shown ?? false;
  if (slot === undefined) return children;
  const control = (
    <span data-demoted={demoted ? '' : undefined} className="contents">
      {children}
    </span>
  );
  return slot ? createPortal(control, slot) : null;
}

const PageEmptyOffer = createContext<Readonly<{
  shown: boolean;
  register: () => () => void;
}> | null>(null);

export function PageEmptyOfferProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [count, setCount] = useState(0);
  const register = useCallback(() => {
    setCount((current) => current + 1);
    return () => setCount((current) => current - 1);
  }, []);
  const value = useMemo(() => ({ shown: count > 0, register }), [count, register]);
  return <PageEmptyOffer.Provider value={value}>{children}</PageEmptyOffer.Provider>;
}

export function usePageEmptyOfferRegister() {
  return useContext(PageEmptyOffer)?.register ?? null;
}

type FoldedEntry = Readonly<{
  key: string;
  label: string;
  icon: Element | null;
  disabled: boolean;
  reason: string | null;
  run:
    | Readonly<{ kind: 'press'; control: HTMLElement }>
    | Readonly<{ kind: 'menu'; items: ReactNode }>;
}>;

const ALWAYS = '[data-in-more]';

export function MastheadOverflow({
  label = 'More',
  children,
}: Readonly<{ label?: string; children: ReactNode }>) {
  const [group, setGroup] = useState<HTMLDivElement | null>(null);
  const [foldedSlot, setFoldedSlot] = useState<HTMLSpanElement | null>(null);
  const [menus] = useState(() => new Map<string, ReactNode>());
  const rowSlot = useContext(MastheadPrimarySlot) ?? null;
  const fold = useFold({ group, rowSlot, foldedSlot });
  const more = group?.querySelector(ALWAYS) ? 'always' : fold.more;
  const moreId = useId();

  return (
    <>
      <span ref={setFoldedSlot} data-masthead-folded-primary="" data-folded-by={moreId} hidden />
      <MastheadPrimarySlot.Provider value={fold.primary ? foldedSlot : rowSlot}>
        <MenuFold.Provider value={menus}>
          <div
            ref={setGroup}
            data-masthead-overflow=""
            data-folded-by={moreId}
            className={GROUP[fold.secondary]}
          >
            {children}
          </div>
        </MenuFold.Provider>
      </MastheadPrimarySlot.Provider>
      {more === 'none' ? null : (
        <MoreMenu
          id={moreId}
          label={label}
          trigger={more === 'always' ? undefined : 'rail:hidden'}
          read={() => foldedEntries([foldedSlot, group], menus)}
        />
      )}
    </>
  );
}

const GROUP = {
  row: 'contents',
  belowRail: 'not-rail:hidden rail:contents',
  folded: 'hidden',
} as const;

function useFold({
  group,
  rowSlot,
  foldedSlot,
}: Readonly<Record<'group' | 'rowSlot' | 'foldedSlot', HTMLElement | null>>) {
  const secondary = useChildCount(group);
  const primary = useChildCount(rowSlot) + useChildCount(foldedSlot);
  const steps = Math.sign(secondary) + Math.sign(primary);
  const stage = useFoldStage(
    group?.closest<HTMLElement>('[data-masthead]') ?? null,
    steps,
    secondary * 10 + primary,
  );
  return foldOf({ secondary, primary, stage, steps });
}

function foldOf({
  secondary,
  primary,
  stage,
  steps,
}: Readonly<Record<'secondary' | 'primary' | 'stage' | 'steps', number>>) {
  const secondaryFolded = secondary > 0 && stage >= 1;
  const primaryFolded = primary > 0 && stage >= steps;
  const belowRail = secondary > 1 || (secondary === 1 && primary > 0);
  const unfolded = belowRail ? 'belowRail' : null;
  return {
    primary: primaryFolded,
    secondary: secondaryFolded ? 'folded' : (unfolded ?? 'row'),
    more: secondaryFolded || primaryFolded ? 'always' : (unfolded ?? 'none'),
  } as const;
}

function MoreMenu({
  id,
  label,
  trigger,
  read,
}: Readonly<{
  id: string;
  label: string;
  trigger: string | undefined;
  read: () => FoldedEntry[];
}>) {
  const [entries, setEntries] = useState<readonly FoldedEntry[]>([]);
  return (
    <Menu
      modal={false}
      onOpenChange={(open) => {
        if (open) setEntries(read());
      }}
    >
      <MenuTrigger asChild>
        <IconButton
          data-folds={id}
          icon={MoreHorizontal}
          label={label}
          variant="secondary"
          className={trigger}
        />
      </MenuTrigger>
      <MenuContent align="end">
        {entries.map((entry) => (
          <FoldedItem key={entry.key} entry={entry} />
        ))}
      </MenuContent>
    </Menu>
  );
}

function FoldedItem({ entry }: Readonly<{ entry: FoldedEntry }>) {
  const icon = entry.icon ? <FoldedIcon glyph={entry.icon} /> : <span />;
  if (entry.run.kind === 'menu') {
    return (
      <MenuSub>
        <MenuSubTrigger icon={icon} disabled={entry.disabled}>
          {entry.label}
        </MenuSubTrigger>
        <MenuNested.Provider value>{entry.run.items}</MenuNested.Provider>
      </MenuSub>
    );
  }
  const { control } = entry.run;
  return (
    <MenuItem
      icon={icon}
      disabled={entry.disabled}
      className="data-[disabled]:text-ink-2"
      onSelect={() => control.click()}
    >
      {entry.reason ? (
        <span className="grid min-w-0">
          <span>{entry.label}</span>
          <span className="type-caption">{entry.reason}</span>
        </span>
      ) : (
        entry.label
      )}
    </MenuItem>
  );
}

function FoldedIcon({ glyph }: Readonly<{ glyph: Element }>) {
  return <span className="contents" ref={(node) => node?.replaceChildren(glyph.cloneNode(true))} />;
}

const CONTROL = 'button, a[href], [data-menu-fold]';

function foldedEntries(
  boxes: readonly (HTMLElement | null)[],
  menus: ReadonlyMap<string, ReactNode>,
): FoldedEntry[] {
  return boxes.flatMap((box, at) =>
    box
      ? [...box.querySelectorAll<HTMLElement>(CONTROL)]
          .filter((node) => !node.parentElement?.closest(CONTROL))
          .flatMap((node, index) => foldedEntry(node, menus, `${at}-${index}`))
      : [],
  );
}

function foldedEntry(
  node: HTMLElement,
  menus: ReadonlyMap<string, ReactNode>,
  key: string,
): FoldedEntry[] {
  const menuId = node.dataset.menuFold;
  const control = menuId ? node.querySelector<HTMLElement>('button, a[href]') : node;
  if (!control) return [];
  const label = (control.getAttribute('aria-label') ?? control.textContent ?? '').trim();
  if (!label || control.checkVisibility?.()) return [];
  const items = menuId ? menus.get(menuId) : undefined;
  return [
    {
      key,
      label,
      icon: leadGlyph(control),
      ...availability(control),
      run: items === undefined ? { kind: 'press', control } : { kind: 'menu', items },
    },
  ];
}

function availability(control: HTMLElement): Pick<FoldedEntry, 'disabled' | 'reason'> {
  const disabled = control.matches(':disabled') || control.getAttribute('aria-disabled') === 'true';
  if (!disabled) return { disabled, reason: null };
  const described = control.getAttribute('aria-describedby');
  const reason = described ? document.getElementById(described)?.textContent?.trim() : null;
  return { disabled, reason: reason || control.getAttribute('title') };
}

function leadGlyph(control: HTMLElement): SVGElement | null {
  const walker = document.createTreeWalker(control, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node instanceof SVGSVGElement) return node;
    if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) return null;
  }
  return null;
}

const UNFOLDED: readonly number[] = [];

function useFoldStage(header: HTMLElement | null, steps: number, controls: number) {
  const [fold, setFold] = useState<Readonly<{ need: readonly number[]; controls: number }> | null>(
    null,
  );
  const need = fold?.controls === controls ? fold.need : UNFOLDED;
  const stage = need.length;
  useEffect(() => {
    if (!header) return;
    const measure = () => {
      const last = need.at(-1);
      if (last !== undefined && header.clientWidth >= last) {
        setFold({ need: need.slice(0, -1), controls });
        return;
      }
      const deficit = rowDeficit(header);
      if (deficit > 1 && stage < steps) {
        setFold({ need: [...need, header.clientWidth + deficit], controls });
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    return () => observer.disconnect();
  }, [header, steps, controls, stage, need]);
  return stage;
}

const TITLE_RESERVE = 360;
const TITLE_SHARE = 0.4;

function rowDeficit(header: HTMLElement): number {
  const title = header.querySelector<HTMLElement>('[data-masthead-title]');
  const heading = title?.querySelector<HTMLElement>('[data-masthead-name]');
  const end = header.querySelector<HTMLElement>('[data-masthead-end]');
  const overflow = title ? Math.max(0, title.scrollWidth - title.clientWidth) : 0;
  const reserve = heading
    ? Math.min(TITLE_RESERVE, TITLE_SHARE * header.clientWidth, heading.scrollWidth)
    : 0;
  const squeezed = Math.max(overflow, reserve - (heading?.clientWidth ?? 0));
  const edge =
    header.getBoundingClientRect().right - Number.parseFloat(getComputedStyle(header).paddingRight);
  const past = end ? Math.max(0, end.getBoundingClientRect().right - edge) : 0;
  return squeezed + past;
}

function useChildCount(node: HTMLElement | null) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!node) return;
    const update = () =>
      setCount(
        [...node.children].filter((child) => child.matches('button, a') || child.firstElementChild)
          .length,
      );
    update();
    const observer = new MutationObserver(update);
    observer.observe(node, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [node]);
  return count;
}
