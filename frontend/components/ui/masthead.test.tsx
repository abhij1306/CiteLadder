import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vite-plus/test';

import { focusByKeyboard } from '@/test/keyboard-focus';
import { emitResize } from '@/test/resize-observer';

import { Button } from './button';
import { Masthead } from './masthead';
import { MastheadPrimary } from './masthead-actions';
import { Menu, MenuContent, MenuItem, MenuTrigger } from './menu';

function EmptyEnd() {
  return null;
}

const TITLE = 'https://www.example.com/blog/how-to-choose-a-crm-for-a-small-agency';
const RECORD =
  'Keyword research for small agency CRM buyers comparing pricing, onboarding and migrations';

describe('Masthead', () => {
  it('lets a cut title take focus and shows the full title in its tooltip', async () => {
    render(<Masthead title={TITLE} />);
    const heading = screen.getByRole('heading', { level: 1, name: TITLE });
    expect(heading).not.toHaveAttribute('tabindex');

    Object.defineProperty(heading, 'clientWidth', { configurable: true, value: 320 });
    Object.defineProperty(heading, 'scrollWidth', { configurable: true, value: 640 });
    act(() => emitResize(heading));
    expect(heading).toHaveAttribute('tabindex', '0');

    focusByKeyboard(heading);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(TITLE);
  });

  it('keeps the primary action beside the title and folds the rest behind More', async () => {
    const user = userEvent.setup();
    let exported = 0;
    const { rerender } = render(
      <Masthead
        title="Website"
        search={<Button>Search</Button>}
        end={<Button>Ask agent</Button>}
        actions={
          <>
            <Button>Crawl schedule</Button>
            <Button onClick={() => (exported += 1)}>Export</Button>
            <MastheadPrimary>
              <Button variant="primary">Run new crawl</Button>
            </MastheadPrimary>
          </>
        }
      />,
    );
    const more = await screen.findByRole('button', { name: 'More' });
    const menu = await openMore(user, more);
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['Crawl schedule', 'Export', 'Search', 'Ask agent']);
    expect(menu.querySelector('button')).toBeNull();
    expect(within(menu).queryByRole('menuitem', { name: 'Run new crawl' })).toBeNull();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(more).toHaveFocus();

    await user.click(within(await openMore(user, more)).getByRole('menuitem', { name: 'Export' }));
    expect(exported).toBe(1);
    expect(screen.queryByRole('menu')).toBeNull();

    rerender(<Masthead title="Website" actions={<Button>Export</Button>} end={<EmptyEnd />} />);
    expect(await screen.findByRole('button', { name: 'Export' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'More' })).toBeNull();
  });

  it('folds the actions before the title keeps less than min(360px, 40%) of the masthead', async () => {
    const user = userEvent.setup();
    render(<Masthead title={RECORD} actions={<Button>Export</Button>} />);
    const header = document.querySelector<HTMLElement>('[data-masthead]')!;
    const heading = screen.getByRole('heading', { level: 1, name: RECORD });
    Object.defineProperty(heading, 'scrollWidth', { configurable: true, value: 720 });
    const fit = (masthead: number, title: number) => {
      Object.defineProperty(header, 'clientWidth', { configurable: true, value: masthead });
      Object.defineProperty(heading, 'clientWidth', { configurable: true, value: title });
      act(() => emitResize(header));
    };

    fit(1366, 400);
    expect(screen.queryByRole('button', { name: 'More' })).toBeNull();

    fit(982, 200);
    const menu = await openMore(user, await screen.findByRole('button', { name: 'More' }));
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['Export']);
  });

  it('offers a folded menu as a submenu and, in a row too full, the primary first', async () => {
    const user = userEvent.setup();
    let edited = 0;
    render(
      <Masthead
        title="Overview"
        search={<Button>Search</Button>}
        actions={
          <>
            <Menu>
              <MenuTrigger asChild>
                <Button>Manage project</Button>
              </MenuTrigger>
              <MenuContent>
                <MenuItem onSelect={() => (edited += 1)}>Edit active project</MenuItem>
              </MenuContent>
            </Menu>
            <MastheadPrimary>
              <Button variant="primary">Run Website crawl</Button>
            </MastheadPrimary>
          </>
        }
      />,
    );
    const header = document.querySelector<HTMLElement>('[data-masthead]')!;
    const end = document.querySelector<HTMLElement>('[data-masthead-end]')!;
    vi.spyOn(end, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 520, 56));
    vi.spyOn(header, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 400, 56));
    for (let step = 0; step < 2; step += 1) act(() => emitResize(header));

    const menu = await openMore(user, await screen.findByRole('button', { name: 'More' }));
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['Run Website crawl', 'Manage project', 'Search']);
    const manage = within(menu).getByRole('menuitem', { name: 'Manage project' });
    expect(manage).toHaveAttribute('aria-haspopup', 'menu');
    act(() => manage.focus());
    await user.keyboard('{ArrowRight}');
    await user.click(await screen.findByRole('menuitem', { name: 'Edit active project' }));
    expect(edited).toBe(1);
  });
});

async function openMore(user: ReturnType<typeof userEvent.setup>, more: HTMLElement) {
  await user.click(more);
  return screen.findByRole('menu');
}
