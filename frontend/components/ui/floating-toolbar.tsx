import type { ReactNode } from 'react';

/**
 * The editing controls that float over a widget's top-end corner while its
 * layout is being edited: a cluster of `IconButton`s lifted off the widget
 * like a menu (the menu surface and shadow), hugging the controls with a 4px
 * inset and 4 between them. Each control names the widget it acts on. The
 * widget it sits on must be `relative`.
 */
export function FloatingToolbar({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="bg-elevated shadow-overlay absolute end-3 top-3 z-10 flex gap-1 rounded-[var(--radius-card)] p-1">
      {children}
    </div>
  );
}
