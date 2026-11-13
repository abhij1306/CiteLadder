import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import { ApiError } from '@/lib/api/errors';
import { projectsApi } from '@/lib/api/projects';
import { promptsApi } from '@/lib/api/prompts';
import { providersApi } from '@/lib/api/providers';
import { queryKeys } from '@/lib/api/query-keys';
import { runsApi } from '@/lib/api/runs';
import { ActiveProjectScopeProvider } from '@/lib/project/active-project-scope';
import { makeProject } from '@/test/fixtures/project';
import { makeFormLimits } from '@/test/fixtures/prompts';
import { providerCatalogFixture } from '@/test/provider-catalog-fixture';
import { renderWithProviders } from '@/test/render';

import { LaunchDialog } from './launch-dialog';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SCOPE_PROJECT = makeProject({ id: PROJECT_ID, workspace_id: WORKSPACE_ID });
const PROMPT_SET_ID = '22222222-2222-4222-8222-222222222222';
const PROMPT_IDS = ['33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444'];

const DEFAULT_MARKET = {
  id: null,
  label: 'United States · English',
  country_code: 'US',
  language_code: 'en',
  is_default: true,
  created_at: null,
};
const GERMANY = {
  id: '55555555-5555-4555-8555-555555555555',
  label: 'Germany · German',
  country_code: 'DE',
  language_code: 'de',
  is_default: false,
  created_at: '2026-10-10T00:00:00Z',
};

/** The dialog as a project route opens it, under the gate's project. */
function RoutedLaunchDialog(props: ComponentProps<typeof LaunchDialog>) {
  return (
    <ActiveProjectScopeProvider project={SCOPE_PROJECT}>
      <LaunchDialog {...props} />
    </ActiveProjectScopeProvider>
  );
}

/** The `/estimate` projection the dialog summarises. The dialog reads only
 * these five fields; the per-engine breakdown is the API layer's contract. */
const ESTIMATE = {
  execution_count: 14,
  maximum_attempt_count: 42,
  maximum_wall_clock_seconds: 900,
  cost_status: 'complete',
  estimated_total_cost_microusd: 123_400,
};

/** The prompt-set list read: the sets plus the launch's repetition range. */
function listed(sets: unknown[], limits = makeFormLimits()) {
  return { prompt_sets: sets, limits };
}

function stubApis(estimate: unknown = undefined) {
  vi.spyOn(promptsApi, 'listPromptSets').mockResolvedValue(
    listed([{ id: PROMPT_SET_ID, name: 'Brand portfolio', prompt_count: 7 }]) as never,
  );
  vi.spyOn(providersApi, 'listConnections').mockResolvedValue([
    {
      api_key_set: true,
      active: true,
      last_test_status: 'ok',
      routes: [{ logical_engine: 'chatgpt' }],
    },
  ] as never);
  vi.spyOn(runsApi, 'estimateAudit').mockResolvedValue(estimate as never);
  vi.spyOn(projectsApi, 'listMarkets').mockResolvedValue([DEFAULT_MARKET]);
  return vi.spyOn(runsApi, 'launchAudit').mockResolvedValue([{ id: 'audit' }] as never);
}

/** Pick one engine, which is what makes the selection launchable. */
async function selectEngineAndLaunch() {
  fireEvent.click(await screen.findByRole('button', { name: 'ChatGPT API' }));
  fireEvent.click(screen.getByRole('button', { name: 'Launch audit' }));
}

describe('Prompt set field', () => {
  afterEach(() => vi.restoreAllMocks());

  it('reports a failed prompt-set read with a retry instead of "no prompt set yet"', async () => {
    stubApis();
    vi.mocked(promptsApi.listPromptSets).mockRejectedValueOnce(
      new ApiError('Prompt sets are unavailable right now.', 400, ''),
    );
    renderWithProviders(
      <RoutedLaunchDialog open onOpenChange={() => undefined} projectId={PROJECT_ID} />,
    );

    expect(await screen.findByText('Prompt sets are unavailable right now.')).toBeVisible();
    expect(screen.queryByText(/No prompt set yet/u)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('combobox', { name: 'Prompt set' })).toBeVisible();
  });

  it('says there is no prompt set only when the read answered with none', async () => {
    stubApis();
    vi.mocked(promptsApi.listPromptSets).mockResolvedValue(listed([]) as never);
    renderWithProviders(
      <RoutedLaunchDialog open onOpenChange={() => undefined} projectId={PROJECT_ID} />,
    );

    expect(
      await screen.findByText('No prompt set yet. Add prompts on the Prompts screen first.'),
    ).toBeVisible();
  });
});

describe('Repetitions', () => {
  afterEach(() => vi.restoreAllMocks());

  it('states and enforces the repetition range the prompt-set list carries', async () => {
    const launch = stubApis();
    vi.mocked(promptsApi.listPromptSets).mockResolvedValue(
      listed(
        [{ id: PROMPT_SET_ID, name: 'Brand portfolio', prompt_count: 7 }],
        makeFormLimits({ audit_repetitions_min: 2, audit_repetitions_max: 4 }),
      ) as never,
    );
    renderWithProviders(
      <RoutedLaunchDialog open onOpenChange={() => undefined} projectId={PROJECT_ID} />,
    );

    expect(
      await screen.findByText('How many times to run each prompt per engine (2–4).'),
    ).toBeInTheDocument();
    const field = screen.getByRole('spinbutton', { name: 'Repetitions' });
    fireEvent.change(field, { target: { value: '9' } });
    fireEvent.blur(field);
    expect(field).toHaveValue(4);
    await selectEngineAndLaunch();
    await waitFor(() =>
      expect(launch).toHaveBeenCalledWith(expect.objectContaining({ repetitions: 4 }), {
        workspaceId: WORKSPACE_ID,
      }),
    );
  });
});

describe('Consumer engine selection', () => {
  afterEach(() => vi.restoreAllMocks());

  it('defaults once, preserves deselection on refetch, and launches all six independently', async () => {
    const launch = stubApis(ESTIMATE);
    const engines = [
      'chatgpt_search',
      'gemini_consumer',
      'google_ai_overview',
      'chatgpt',
      'gemini',
      'claude',
    ];
    vi.mocked(providersApi.listConnections).mockResolvedValue([
      {
        active: true,
        api_key_set: true,
        last_test_status: 'ok',
        routes: engines.map((logical_engine) => ({ logical_engine, active: true })),
      },
    ] as never);
    const { queryClient } = renderWithProviders(
      <RoutedLaunchDialog
        open
        onOpenChange={() => undefined}
        projectId={PROJECT_ID}
        fixedPromptIds={PROMPT_IDS}
      />,
    );
    const search = await screen.findByRole('button', { name: 'ChatGPT Search' });
    await waitFor(() => expect(search).toHaveAttribute('aria-pressed', 'true'));
    expect(screen.getByRole('button', { name: 'ChatGPT API' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    fireEvent.click(search);
    await act(async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.providers.connections(WORKSPACE_ID),
      });
    });
    expect(search).toHaveAttribute('aria-pressed', 'false');
    for (const name of ['ChatGPT Search', 'ChatGPT API', 'Gemini API', 'Claude API']) {
      fireEvent.click(screen.getByRole('button', { name }));
    }
    fireEvent.click(screen.getByRole('button', { name: 'Launch audit' }));
    await waitFor(() =>
      expect(launch).toHaveBeenCalledWith(
        expect.objectContaining({
          engines: expect.arrayContaining(engines),
        }),
        { workspaceId: WORKSPACE_ID },
      ),
    );
    expect(vi.mocked(launch).mock.calls[0]![0].engines).toHaveLength(6);
  });
});

describe('Market selection', () => {
  afterEach(() => vi.restoreAllMocks());

  it('launches the default market alone unless more are picked', async () => {
    const launch = stubApis(ESTIMATE);
    renderWithProviders(
      <RoutedLaunchDialog
        open
        onOpenChange={() => undefined}
        projectId={PROJECT_ID}
        fixedPromptIds={PROMPT_IDS}
      />,
    );
    await selectEngineAndLaunch();
    await waitFor(() => expect(launch).toHaveBeenCalled());
    expect(vi.mocked(launch).mock.calls[0]![0].market_ids).toEqual([null]);
    expect(screen.queryByRole('group', { name: /Markets/ })).not.toBeInTheDocument();
  });

  it('launches one run per picked market and refuses an empty market set', async () => {
    const launch = stubApis(ESTIMATE);
    vi.mocked(projectsApi.listMarkets).mockResolvedValue([DEFAULT_MARKET, GERMANY]);
    renderWithProviders(
      <RoutedLaunchDialog
        open
        onOpenChange={() => undefined}
        projectId={PROJECT_ID}
        fixedPromptIds={PROMPT_IDS}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'ChatGPT API' }));
    const fallback = await screen.findByRole('button', { name: 'United States · English' });
    fireEvent.click(fallback);
    expect(screen.getByRole('button', { name: 'Launch audit' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Germany · German' }));
    fireEvent.click(fallback);
    fireEvent.click(screen.getByRole('button', { name: 'Launch audit' }));
    await waitFor(() => expect(launch).toHaveBeenCalled());
    expect(vi.mocked(launch).mock.calls[0]![0].market_ids).toEqual([GERMANY.id, null]);
  });
});

describe('Inline provider setup', () => {
  afterEach(() => vi.restoreAllMocks());

  it("opens the clicked engine's provider inside the launch dialog, then closes", async () => {
    stubApis();
    vi.spyOn(providersApi, 'getCatalog').mockResolvedValue(providerCatalogFixture as never);
    vi.spyOn(providersApi, 'getConnectionStates').mockResolvedValue({
      workspace_id: WORKSPACE_ID,
      providers: [],
    } as never);
    const dialog = (open: boolean) => (
      <RoutedLaunchDialog
        open={open}
        onOpenChange={() => undefined}
        projectId={PROJECT_ID}
        fixedPromptIds={PROMPT_IDS}
      />
    );
    const { rerender } = renderWithProviders(dialog(true));

    fireEvent.click(await screen.findByRole('button', { name: 'Claude API, not connected' }));

    const setup = await screen.findByRole('region', { name: 'Connect a provider' });
    // Set up in place: no second dialog is stacked on the launch dialog.
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    // The provider that measures Claude arrives open on its credential form.
    expect(await within(setup).findByRole('button', { name: 'Close Anthropic' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(within(setup).getByLabelText(/api key/i)).toBeInTheDocument();

    fireEvent.click(within(setup).getByRole('button', { name: 'Close provider setup' }));
    expect(screen.queryByRole('region', { name: 'Connect a provider' })).toBeNull();

    // Closed by its owner mid-setup, the dialog reopens without the panel.
    fireEvent.click(screen.getByRole('button', { name: 'Claude API, not connected' }));
    await screen.findByRole('region', { name: 'Connect a provider' });
    rerender(dialog(false));
    rerender(dialog(true));
    await screen.findByRole('button', { name: 'Launch audit' });
    expect(screen.queryByRole('region', { name: 'Connect a provider' })).toBeNull();
  });
});

describe('Engine availability changes', () => {
  afterEach(() => vi.restoreAllMocks());

  it('drops a selected engine from the picker and payload when its route goes inactive', async () => {
    stubApis(ESTIMATE);
    const connection = (active: boolean) => [
      {
        active: true,
        api_key_set: true,
        last_test_status: 'ok',
        routes: [
          { logical_engine: 'chatgpt_search', active },
          { logical_engine: 'chatgpt', active: true },
        ],
      },
    ];
    vi.mocked(providersApi.listConnections).mockResolvedValue(connection(true) as never);
    const { queryClient } = renderWithProviders(
      <RoutedLaunchDialog
        open
        onOpenChange={() => undefined}
        projectId={PROJECT_ID}
        fixedPromptIds={PROMPT_IDS}
      />,
    );
    const search = await screen.findByRole('button', { name: 'ChatGPT Search' });
    await waitFor(() => expect(search).toHaveAttribute('aria-pressed', 'true'));

    vi.mocked(providersApi.listConnections).mockResolvedValue(connection(false) as never);
    await act(async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.providers.connections(WORKSPACE_ID),
      });
    });

    expect(
      await screen.findByRole('button', { name: 'ChatGPT Search, not connected' }),
    ).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Launch audit' })).toBeDisabled();
  });
});

describe('LaunchDialog fixed prompt selection', () => {
  afterEach(() => vi.restoreAllMocks());

  it('summarises the estimate once it resolves', async () => {
    // Every other test in this file stubs `estimateAudit` to resolve
    // undefined, so the summary branch was only ever rendered by the two
    // full-page suites that each re-declared this payload.
    stubApis(ESTIMATE);

    renderWithProviders(
      <RoutedLaunchDialog
        open
        onOpenChange={() => undefined}
        projectId={PROJECT_ID}
        fixedPromptIds={PROMPT_IDS}
        auditScope="commerce"
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'ChatGPT API' }));
    expect(await screen.findByText('14 responses planned')).toBeInTheDocument();
    // Cost is rendered from microUSD, so a formatting slip shows up as money.
    expect(
      screen.getByText(/Maximum wall-clock budget 900s · cost complete · ~\$0\.1234/),
    ).toBeInTheDocument();
  });

  it('marks the cost unavailable rather than printing a fabricated zero', async () => {
    stubApis({
      ...ESTIMATE,
      execution_count: 1,
      cost_status: 'unpriced',
      estimated_total_cost_microusd: null,
    });

    renderWithProviders(
      <RoutedLaunchDialog
        open
        onOpenChange={() => undefined}
        projectId={PROJECT_ID}
        fixedPromptIds={PROMPT_IDS}
        auditScope="commerce"
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'ChatGPT API' }));
    // Singular, and never "~$0.0000".
    expect(await screen.findByText('1 response planned')).toBeInTheDocument();
    expect(screen.getByText(/cost unpriced · unavailable/)).toBeInTheDocument();
    expect(screen.queryByText(/\$0\.0000/)).not.toBeInTheDocument();
  });

  it('locks the field and shows the selection the prompt_ids payload uses', async () => {
    // `promptSetLocked` was derived from `fixedPromptSetId` alone, so a
    // `fixedPromptIds` caller kept an editable prompt-set select whose value
    // `buildLaunchPayload` then ignored.
    const launch = stubApis();

    renderWithProviders(
      <RoutedLaunchDialog
        open
        onOpenChange={() => undefined}
        projectId={PROJECT_ID}
        fixedPromptIds={PROMPT_IDS}
        auditScope="commerce"
      />,
    );

    expect(await screen.findByText('2 selected prompts')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    await selectEngineAndLaunch();

    await waitFor(() =>
      expect(launch).toHaveBeenCalledWith(
        {
          project_id: PROJECT_ID,
          prompt_ids: PROMPT_IDS,
          engines: ['chatgpt'],
          market_ids: [null],
          repetitions: expect.any(Number),
          audit_scope: 'commerce',
        },
        { workspaceId: WORKSPACE_ID },
      ),
    );
  });

  it('prefers an explicit selection label over the derived prompt count', async () => {
    const launch = stubApis();

    renderWithProviders(
      <RoutedLaunchDialog
        open
        onOpenChange={() => undefined}
        projectId={PROJECT_ID}
        fixedPromptIds={PROMPT_IDS}
        promptSelectionLabel="2 approved prompts for Running shoes"
        auditScope="commerce"
      />,
    );

    expect(await screen.findByText('2 approved prompts for Running shoes')).toBeInTheDocument();
    await selectEngineAndLaunch();

    await waitFor(() =>
      expect(launch).toHaveBeenCalledWith(expect.objectContaining({ prompt_ids: PROMPT_IDS }), {
        workspaceId: WORKSPACE_ID,
      }),
    );
  });

  it('locks a fixed prompt set and launches that same set', async () => {
    const launch = stubApis();

    renderWithProviders(
      <RoutedLaunchDialog
        open
        onOpenChange={() => undefined}
        projectId={PROJECT_ID}
        fixedPromptSetId={PROMPT_SET_ID}
        promptSelectionLabel="Commerce Product Visibility"
      />,
    );

    expect(await screen.findByText('Commerce Product Visibility')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    await selectEngineAndLaunch();

    await waitFor(() =>
      expect(launch).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt_set_id: PROMPT_SET_ID,
          audit_scope: 'brand',
        }),
        { workspaceId: WORKSPACE_ID },
      ),
    );
  });
});

describe('LaunchDialog prompt batching', () => {
  afterEach(() => vi.restoreAllMocks());

  /** A set of `count` audit-eligible prompts, in creation order. */
  function setWithPrompts(count: number) {
    return listed([
      {
        id: PROMPT_SET_ID,
        name: 'Brand portfolio',
        prompt_count: count,
        prompts: Array.from({ length: count }, (_, index) => ({
          id: `prompt-${String(index).padStart(2, '0')}`,
          text: `Prompt ${index}`,
          enabled: true,
          status: 'active',
          created_at: `2026-01-${String(index + 1).padStart(2, '0')}T00:00:00Z`,
        })),
      },
    ]);
  }

  it('runs a chosen batch of ten as an explicit prompt id list', async () => {
    const user = userEvent.setup();
    // The launch screen used to offer no choice: picking a set ran every
    // prompt in it, however large and however expensive.
    const launch = stubApis();
    vi.spyOn(promptsApi, 'listPromptSets').mockResolvedValue(setWithPrompts(23) as never);

    renderWithProviders(
      <RoutedLaunchDialog open onOpenChange={() => undefined} projectId={PROJECT_ID} />,
    );

    const batchSelect = await screen.findByLabelText(/Prompts to run/);
    await user.click(batchSelect);
    expect(screen.getByRole('option', { name: 'All 23 prompts' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Prompts 21-23' })).toBeInTheDocument();
    await user.click(screen.getByRole('option', { name: 'Prompts 11-20' }));
    await selectEngineAndLaunch();

    await waitFor(() =>
      expect(launch).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt_ids: Array.from({ length: 10 }, (_, index) => `prompt-${index + 10}`),
        }),
        { workspaceId: WORKSPACE_ID },
      ),
    );
    expect(launch.mock.calls[0]![0]).not.toHaveProperty('prompt_set_id');
  });

  it('runs the whole set by default, and offers no batching below one batch', async () => {
    const launch = stubApis();
    vi.spyOn(promptsApi, 'listPromptSets').mockResolvedValue(setWithPrompts(7) as never);

    renderWithProviders(
      <RoutedLaunchDialog open onOpenChange={() => undefined} projectId={PROJECT_ID} />,
    );

    await screen.findByRole('button', { name: 'ChatGPT API' });
    // Seven prompts is one batch: "All 7" and "Prompts 1-7" are the same run.
    expect(screen.queryByLabelText(/Prompts to run/)).not.toBeInTheDocument();
    await selectEngineAndLaunch();

    await waitFor(() =>
      expect(launch).toHaveBeenCalledWith(
        expect.objectContaining({ prompt_set_id: PROMPT_SET_ID }),
        { workspaceId: WORKSPACE_ID },
      ),
    );
  });

  it('does not turn a stale batch selection into a whole-set launch after refresh', async () => {
    const user = userEvent.setup();
    const launch = stubApis();
    vi.spyOn(promptsApi, 'listPromptSets').mockResolvedValue(setWithPrompts(23) as never);

    const { queryClient } = renderWithProviders(
      <RoutedLaunchDialog open onOpenChange={() => undefined} projectId={PROJECT_ID} />,
    );

    await user.click(await screen.findByLabelText(/Prompts to run/));
    await user.click(screen.getByRole('option', { name: 'Prompts 21-23' }));
    fireEvent.click(screen.getByRole('button', { name: 'ChatGPT API' }));
    expect(screen.getByRole('button', { name: 'Launch audit' })).toBeEnabled();

    act(() => {
      queryClient.setQueryData(
        queryKeys.prompts.sets({ workspaceId: WORKSPACE_ID, projectId: PROJECT_ID }),
        setWithPrompts(7),
      );
    });

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Launch audit' })).toBeDisabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Launch audit' }));
    expect(launch).not.toHaveBeenCalled();

    const recoverySelect = screen.getByLabelText(/Prompts to run/);
    await user.click(recoverySelect);
    expect(screen.getByRole('option', { name: 'All 7 prompts' })).toBeInTheDocument();
    await user.click(screen.getByRole('option', { name: 'All 7 prompts' }));
    expect(screen.getByRole('button', { name: 'Launch audit' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Launch audit' }));
    await waitFor(() =>
      expect(launch).toHaveBeenCalledWith(
        expect.objectContaining({ prompt_set_id: PROMPT_SET_ID }),
        { workspaceId: WORKSPACE_ID },
      ),
    );
  });
});
