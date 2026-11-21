import { act, fireEvent } from '@testing-library/react';

export function focusByKeyboard(element: HTMLElement) {
  act(() => {
    fireEvent.keyDown(document.body, { key: 'Tab' });
    element.focus();
  });
}
