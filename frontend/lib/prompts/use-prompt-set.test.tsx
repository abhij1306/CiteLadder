import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vite-plus/test';

import { promptsApi } from '@/lib/api/prompts';
import { ApiError } from '@/lib/api/errors';
import type { PromptSet } from '@/lib/api/types';
import { makeProject } from '@/test/fixtures/project';
import { makeSet } from '@/test/fixtures/prompts';
import { renderWithProviders } from '@/test/render';
import { usePromptSet } from './use-prompt-set';

afterEach(() => vi.restoreAllMocks());

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function Consumer({ name }: Readonly<{ name: string }>) {
  const { ensurePromptSet } = usePromptSet();
  const [result, setResult] = useState('');
  return (
    <>
      <button
        onClick={async () => {
          try {
            setResult((await ensurePromptSet()).id);
          } catch {
            setResult('unavailable');
          }
        }}
      >
        {name}
      </button>
      <output aria-label={`${name} result`}>{result}</output>
    </>
  );
}

function renderConsumers() {
  const project = makeProject();
  return renderWithProviders(
    <>
      <Consumer name="First" />
      <Consumer name="Second" />
    </>,
    {
      projectSelection: { activeProject: project, activeProjectId: project.id, status: 'ready' },
    },
  );
}

it('waits for an in-flight list and reuses its set instead of creating one', async () => {
  const read = deferred<PromptSet[]>();
  const list = vi.spyOn(promptsApi, 'listPromptSets').mockReturnValue(read.promise);
  const create = vi.spyOn(promptsApi, 'createPromptSet');
  renderConsumers();
  await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
  await userEvent.setup().click(screen.getByRole('button', { name: 'First' }));
  expect(create).not.toHaveBeenCalled();
  read.resolve([makeSet([])]);
  await waitFor(() =>
    expect(screen.getByRole('status', { name: 'First result' })).toHaveTextContent(makeSet([]).id),
  );
  expect(create).not.toHaveBeenCalled();
});

it('serializes simultaneous creates from different consumers in the same project', async () => {
  let saved: PromptSet[] = [];
  vi.spyOn(promptsApi, 'listPromptSets').mockImplementation(async () => saved);
  const write = deferred<PromptSet>();
  const create = vi.spyOn(promptsApi, 'createPromptSet').mockImplementation(async () => {
    const set = await write.promise;
    saved = [set];
    return set;
  });
  renderConsumers();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'First' }));
  await user.click(screen.getByRole('button', { name: 'Second' }));
  write.resolve(makeSet([]));
  await waitFor(() =>
    expect(screen.getByRole('status', { name: 'Second result' })).toHaveTextContent(makeSet([]).id),
  );
  expect(create).toHaveBeenCalledTimes(1);
});

it('does not interpret a failed lookup as an empty project', async () => {
  vi.spyOn(promptsApi, 'listPromptSets').mockRejectedValue(new ApiError('unavailable', 403, ''));
  const create = vi.spyOn(promptsApi, 'createPromptSet');
  renderConsumers();
  await userEvent.setup().click(screen.getByRole('button', { name: 'First' }));
  await waitFor(() =>
    expect(screen.getByRole('status', { name: 'First result' })).toHaveTextContent('unavailable'),
  );
  expect(create).not.toHaveBeenCalled();
});
