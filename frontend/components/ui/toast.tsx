'use client';

import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import * as ToastPrimitive from '@radix-ui/react-toast';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type ToastTone = 'neutral' | 'positive' | 'negative';

type ToastOptions = Readonly<{
  tone?: ToastTone;
  /** The one next step ("Undo", "Retry now"), a small secondary button under the text. */
  action?: Readonly<{ label: string; onClick: () => void }>;
}>;

type ToastMessage = ToastOptions & { id: number; title: string; description?: string };
type ToastApi = { notify: (title: string, description?: string, options?: ToastOptions) => void };

const ToastContext = createContext<ToastApi>({ notify: () => undefined });

/** Neutral and positive toasts close after 6s unless hovered or focused; negative ones stay. */
const TOAST_DURATION_MS = 6000;
/** Never more than three at once: the oldest leaves first. */
const MAX_TOASTS = 3;

const TONE_ICON = {
  neutral: { Icon: Info, className: 'text-ink-secondary', word: 'Notice' },
  positive: { Icon: CheckCircle2, className: 'text-positive', word: 'Success' },
  negative: { Icon: AlertCircle, className: 'text-negative', word: 'Error' },
} as const;

/**
 * Toast — a brief message about something that just happened, bottom-right,
 * newest at the bottom: `surface`, `radius-lg`, `shadow-pop`, 400px. The tone
 * shows only in the 16px icon plus a screen-reader word; negative toasts are
 * announced assertively and stay until dismissed.
 */
export function ToastProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [messages, setMessages] = useState<ToastMessage[]>([]);
  const nextMessageId = useRef(0);
  const notify = useCallback((title: string, description?: string, options?: ToastOptions) => {
    nextMessageId.current += 1;
    const id = nextMessageId.current;
    setMessages((current) =>
      current.some((message) => message.title === title && message.description === description)
        ? current
        : [...current, { ...options, id, title, description }].slice(-MAX_TOASTS),
    );
  }, []);
  const value = useMemo(() => ({ notify }), [notify]);

  return (
    <ToastContext value={value}>
      <ToastPrimitive.Provider swipeDirection="right" label="Notifications">
        {children}
        {messages.map((message) => {
          const tone = message.tone ?? 'neutral';
          const { Icon, className, word } = TONE_ICON[tone];
          return (
            <ToastPrimitive.Root
              key={message.id}
              type={tone === 'negative' ? 'foreground' : 'background'}
              duration={tone === 'negative' ? Infinity : TOAST_DURATION_MS}
              onOpenChange={(open) => {
                if (!open)
                  setMessages((current) => current.filter((item) => item.id !== message.id));
              }}
              className="toast-panel bg-surface text-ink shadow-pop flex w-100 max-w-full items-start gap-3 rounded-lg py-3 ps-4 pe-3"
            >
              <span className={cn('inline-flex h-5 shrink-0 items-center', className)}>
                <Icon className="size-4" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <ToastPrimitive.Title className="text-body-sm text-ink font-medium">
                  <span className="sr-only">{`${word}: `}</span>
                  {message.title}
                </ToastPrimitive.Title>
                {message.description ? (
                  <ToastPrimitive.Description className="text-body-sm text-ink-secondary mt-0.5">
                    {message.description}
                  </ToastPrimitive.Description>
                ) : null}
                {message.action ? (
                  <div className="mt-3 flex gap-2">
                    <ToastPrimitive.Action asChild altText={message.action.label}>
                      <Button onClick={message.action.onClick}>{message.action.label}</Button>
                    </ToastPrimitive.Action>
                  </div>
                ) : null}
              </div>
              <ToastPrimitive.Close
                className="focus-ring text-ink-secondary not-disabled:hover:bg-surface-sunken not-disabled:hover:text-ink -m-1 grid size-[var(--control-sm)] shrink-0 place-items-center rounded-sm"
                aria-label="Dismiss notification"
              >
                <X className="size-4" aria-hidden />
              </ToastPrimitive.Close>
            </ToastPrimitive.Root>
          );
        })}
        <ToastPrimitive.Viewport className="focus-ring z-toast fixed right-4 bottom-4 flex max-w-[calc(100vw-2rem)] flex-col gap-2" />
      </ToastPrimitive.Provider>
    </ToastContext>
  );
}

export function useToast(): ToastApi {
  return useContext(ToastContext);
}
