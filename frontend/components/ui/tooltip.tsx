import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import {
  type ComponentProps,
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useRef,
  useState,
} from 'react';

import { focusFromKeyboard } from '@/components/ui/input-modality';
import { POP_FACE } from '@/components/ui/slip';
import { cn } from '@/lib/utils';

const Provided = createContext(false);

export const TOOLTIP_SHEET = cn(
  POP_FACE,
  'tooltip-panel z-modal type-caption block max-w-72 min-w-0 px-2 py-1 [overflow-wrap:anywhere]',
);

export function isTextCut(node: Element): boolean {
  return node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1;
}

export function TooltipProvider(props: Readonly<ComponentProps<typeof TooltipPrimitive.Provider>>) {
  return (
    <Provided.Provider value={true}>
      <TooltipPrimitive.Provider delayDuration={300} {...props} />
    </Provided.Provider>
  );
}

export function Tooltip({
  children,
  content,
  side = 'top',
  shortcut,
  describe = true,
  shouldOpen,
}: Readonly<{
  children: ReactNode;
  content: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  shortcut?: string;
  describe?: boolean;
  shouldOpen?: (trigger: HTMLElement) => boolean;
}>) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLElement | null>(null);
  const setTrigger = useCallback((node: HTMLElement | null) => {
    trigger.current = node;
  }, []);
  const onOpenChange = (next: boolean) => {
    if (!next || shouldOpen === undefined) {
      setOpen(next);
      return;
    }
    setOpen(trigger.current !== null && shouldOpen(trigger.current));
  };
  const provided = useContext(Provided);
  const tooltip = (
    <TooltipPrimitive.Root delayDuration={300} open={open} onOpenChange={onOpenChange}>
      <TooltipPrimitive.Trigger
        asChild
        ref={setTrigger}
        onFocus={(event) => {
          if (!focusFromKeyboard()) event.preventDefault();
        }}
        {...(describe ? {} : { 'aria-describedby': undefined })}
      >
        {children}
      </TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={8}
          avoidCollisions
          collisionPadding={8}
          className={TOOLTIP_SHEET}
        >
          <span className="flex items-baseline gap-2">
            <span className="min-w-0 flex-1">{content}</span>
            {shortcut ? <span className="type-code text-ink-2 shrink-0">{shortcut}</span> : null}
          </span>
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
  return provided ? tooltip : <TooltipPrimitive.Provider>{tooltip}</TooltipPrimitive.Provider>;
}
