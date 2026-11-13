import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vite-plus/test';

import { focusByKeyboard } from '@/test/keyboard-focus';
import { emitResize } from '@/test/resize-observer';

import { PageHeader } from './page-header';

const TITLE = 'https://www.example.com/blog/how-to-choose-a-crm-for-a-small-agency';

describe('PageHeader', () => {
  it('lets a cut title take focus and shows the full title in its tooltip', async () => {
    render(<PageHeader title={TITLE} />);
    const heading = screen.getByRole('heading', { level: 1, name: TITLE });
    expect(heading).not.toHaveAttribute('tabindex');

    // One line: the title is cut along its width, never wrapped to a second row.
    Object.defineProperty(heading, 'clientWidth', { configurable: true, value: 320 });
    Object.defineProperty(heading, 'scrollWidth', { configurable: true, value: 640 });
    act(() => emitResize(heading));
    expect(heading).toHaveAttribute('tabindex', '0');

    focusByKeyboard(heading);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(TITLE);
  });
});
