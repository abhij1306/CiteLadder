import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { createMemoryRouter, Link, RouterProvider } from 'react-router-dom';
import { expect, it } from 'vite-plus/test';

import { UnsavedChangesGuard } from './unsaved-changes-guard';

function Editor() {
  const [dirty, setDirty] = useState(false);
  return (
    <>
      <h1>Editor</h1>
      <UnsavedChangesGuard when={dirty} />
      {/* A second, clean editor on the same screen (another output of the chat). */}
      <UnsavedChangesGuard when={false} />
      <button type="button" onClick={() => setDirty(true)}>
        Edit
      </button>
      <Link to="/editor?tab=outline">Outline tab</Link>
      <Link to="/elsewhere">Elsewhere</Link>
    </>
  );
}

function renderEditor() {
  const router = createMemoryRouter(
    [
      { path: '/editor', element: <Editor /> },
      { path: '/elsewhere', element: <h1>Elsewhere</h1> },
    ],
    { initialEntries: ['/editor'] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

function closeTab() {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

it('leaves freely and closes the tab without a prompt while nothing is unsaved', async () => {
  const user = userEvent.setup();
  const router = renderEditor();
  expect(closeTab()).toBe(false);
  await user.click(screen.getByRole('link', { name: 'Elsewhere' }));
  expect(await screen.findByRole('heading', { name: 'Elsewhere' })).toBeVisible();
  expect(router.state.location.pathname).toBe('/elsewhere');
});

it('asks before unsaved edits are discarded by leaving or closing the tab', async () => {
  const user = userEvent.setup();
  const router = renderEditor();
  await user.click(screen.getByRole('button', { name: 'Edit' }));
  expect(closeTab()).toBe(true);

  // A tab held in the URL stays on the screen, so it is not a discard.
  await user.click(screen.getByRole('link', { name: 'Outline tab' }));
  expect(router.state.location.search).toBe('?tab=outline');
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();

  await user.click(screen.getByRole('link', { name: 'Elsewhere' }));
  const confirm = await screen.findByRole('alertdialog', { name: 'Discard unsaved changes?' });
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(confirm).not.toBeInTheDocument());
  expect(router.state.location.pathname).toBe('/editor');

  await user.click(screen.getByRole('link', { name: 'Elsewhere' }));
  await user.click(await screen.findByRole('button', { name: 'Discard and leave' }));
  expect(await screen.findByRole('heading', { name: 'Elsewhere' })).toBeVisible();
  expect(router.state.location.pathname).toBe('/elsewhere');
});
