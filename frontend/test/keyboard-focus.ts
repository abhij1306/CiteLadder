import { act, fireEvent } from '@testing-library/react';

/**
 * Moves focus to `element` as a keyboard reader does: a Tab press, then the
 * focus. A tooltip opens only for keyboard focus (components/ui/input-modality.ts),
 * so a test reaching a control deep in the tab order uses this instead of
 * tabbing through every stop before it.
 */
export function focusByKeyboard(element: HTMLElement) {
  act(() => {
    fireEvent.keyDown(document.body, { key: 'Tab' });
    element.focus();
  });
}
