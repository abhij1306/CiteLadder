'use client';

import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import * as ToastPrimitive from '@radix-ui/react-toast';
import { CheckCircle2, X } from 'lucide-react';

import { Pressable } from './pressable';

type ToastMessage = { id: number; title: string; description?: string };
type ToastApi = { notify: (title: string, description?: string) => void };

const ToastContext = createContext<ToastApi>({ notify: () => undefined });

export function ToastProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [messages, setMessages] = useState<ToastMessage[]>([]);
  const nextMessageId = useRef(0);
  const notify = useCallback((title: string, description?: string) => {
    nextMessageId.current += 1;
    const id = nextMessageId.current;
    setMessages((current) =>
      current.some((message) => message.title === title && message.description === description)
        ? current
        : [...current, { id, title, description }],
    );
  }, []);
  const value = useMemo(() => ({ notify }), [notify]);

  return (
    <ToastContext value={value}>
      <ToastPrimitive.Provider swipeDirection="right">
        {children}
        {messages.map((message) => (
          <ToastPrimitive.Root
            key={message.id}
            duration={3500}
            onOpenChange={(open) => {
              if (!open) setMessages((current) => current.filter((item) => item.id !== message.id));
            }}
            className="toast-panel bg-elevated shadow-modal grid w-[min(24rem,calc(100vw-2rem))] grid-cols-[auto_1fr_auto] items-start gap-2 rounded-[var(--radius-card)] border border-transparent p-3"
          >
            <CheckCircle2 className="text-success mt-0.5 size-4" aria-hidden />
            <div className="min-w-0">
              <ToastPrimitive.Title className="type-item-title text-current">
                {message.title}
              </ToastPrimitive.Title>
              {message.description ? (
                <ToastPrimitive.Description className="type-caption mt-0.5">
                  {message.description}
                </ToastPrimitive.Description>
              ) : null}
            </div>
            <ToastPrimitive.Close asChild>
              <Pressable
                className="text-muted hover:bg-hover active:bg-active grid size-[var(--control-height-sm)] place-items-center"
                aria-label="Dismiss notification"
              >
                <X className="size-3.5" aria-hidden />
              </Pressable>
            </ToastPrimitive.Close>
          </ToastPrimitive.Root>
        ))}
        <ToastPrimitive.Viewport className="focus-ring fixed right-4 bottom-4 z-[var(--z-index-toast)] grid gap-2" />
      </ToastPrimitive.Provider>
    </ToastContext>
  );
}

export function useToast(): ToastApi {
  return useContext(ToastContext);
}
