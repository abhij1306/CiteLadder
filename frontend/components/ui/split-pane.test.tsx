import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import { ResizableSplitPane } from './split-pane';

const LABEL = 'Resize topics panel';

function rect(width: number): DOMRect {
  return {
    width,
    height: 600,
    top: 0,
    right: width,
    bottom: 600,
    left: 0,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  };
}

function renderPane(
  props: Partial<{ width: number; onWidthCommit: (width: number) => void }> = {},
) {
  const result = render(
    <ResizableSplitPane
      list={<nav aria-label="Topics">Topics</nav>}
      listId="topics"
      separatorLabel={LABEL}
      defaultWidth={240}
      minWidth={208}
      maxWidth={400}
      minDetailWidth={572}
      {...props}
    >
      <p>Detail</p>
    </ResizableSplitPane>,
  );
  const container = result.container.firstElementChild as HTMLDivElement;
  vi.spyOn(container, 'getBoundingClientRect').mockReturnValue(rect(1000));
  const separator = screen.getByRole('separator', { name: LABEL }) as HTMLDivElement;
  separator.setPointerCapture = vi.fn();
  separator.hasPointerCapture = vi.fn(() => true);
  separator.releasePointerCapture = vi.fn();
  return { ...result, container, separator };
}

describe('ResizableSplitPane', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('resizes the list from the keyboard within its bounds', () => {
    const onWidthCommit = vi.fn();
    const { separator } = renderPane({ onWidthCommit });
    expect(separator).toHaveAttribute('aria-controls', 'topics');
    fireEvent.keyDown(separator, { key: 'ArrowRight' });
    expect(separator).toHaveAttribute('aria-valuenow', '256');
    fireEvent.keyDown(separator, { key: 'ArrowLeft', shiftKey: true });
    expect(separator).toHaveAttribute('aria-valuenow', '208');
    fireEvent.keyDown(separator, { key: 'End' });
    expect(separator).toHaveAttribute('aria-valuenow', '400');
    fireEvent.keyDown(separator, { key: 'Home' });
    expect(separator).toHaveAttribute('aria-valuenow', '208');
    expect(onWidthCommit).toHaveBeenLastCalledWith(208);
  });

  it('keeps the detail its minimum when the container narrows', () => {
    const { container, separator } = renderPane();
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue(rect(800));
    fireEvent.keyDown(separator, { key: 'End' });
    expect(separator).toHaveAttribute('aria-valuemax', '228');
    expect(separator).toHaveAttribute('aria-valuenow', '228');
  });

  it('tracks a captured pointer and restores document interaction', () => {
    const { separator } = renderPane();
    fireEvent.pointerDown(separator, { button: 0, pointerId: 7, clientX: 300 });
    expect(separator.setPointerCapture).toHaveBeenCalledWith(7);
    expect(document.body.style.cursor).toBe('col-resize');
    fireEvent.pointerMove(separator, { pointerId: 7, clientX: 380 });
    expect(separator).toHaveAttribute('aria-valuenow', '320');
    fireEvent.pointerUp(separator, { pointerId: 7 });
    expect(separator.releasePointerCapture).toHaveBeenCalledWith(7);
    expect(document.body.style.cursor).toBe('');
    expect(document.body.style.userSelect).toBe('');
  });

  it('restores the starting width when the pointer is cancelled', () => {
    const onWidthCommit = vi.fn();
    const { separator } = renderPane({ onWidthCommit });
    fireEvent.pointerDown(separator, { button: 0, pointerId: 9, clientX: 300 });
    fireEvent.pointerMove(separator, { pointerId: 9, clientX: 348 });
    fireEvent.pointerCancel(separator, { pointerId: 9 });
    expect(separator).toHaveAttribute('aria-valuenow', '240');
    expect(separator.releasePointerCapture).toHaveBeenCalledWith(9);
    expect(document.body.style.cursor).toBe('');
    expect(onWidthCommit).not.toHaveBeenCalled();
  });

  it('resets to the default width on double click', () => {
    const { separator } = renderPane();
    fireEvent.keyDown(separator, { key: 'End' });
    fireEvent.doubleClick(separator);
    expect(separator).toHaveAttribute('aria-valuenow', '240');
  });

  it('follows a drag from the stored width and reports only the settled width', () => {
    const onWidthCommit = vi.fn();
    const { separator } = renderPane({ width: 300, onWidthCommit });
    expect(separator).toHaveAttribute('aria-valuenow', '300');
    fireEvent.pointerDown(separator, { button: 0, pointerId: 3, clientX: 300 });
    fireEvent.pointerMove(separator, { pointerId: 3, clientX: 340 });
    expect(separator).toHaveAttribute('aria-valuenow', '340');
    expect(onWidthCommit).not.toHaveBeenCalled();
    fireEvent.pointerUp(separator, { pointerId: 3 });
    expect(onWidthCommit).toHaveBeenCalledExactlyOnceWith(340);
  });

  it('keeps one resize observer while the width changes', () => {
    const createObserver = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor() {
          createObserver();
        }
        observe = vi.fn();
        disconnect = disconnect;
      },
    );
    const { separator, unmount } = renderPane();
    fireEvent.keyDown(separator, { key: 'ArrowRight' });
    expect(createObserver).toHaveBeenCalledOnce();
    unmount();
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
