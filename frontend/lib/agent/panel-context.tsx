'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { agentHandoff, type AgentHandoff, type HandoffInput } from '@/lib/agent/handoff';

/**
 * The global agent panel's shared state: whether it is open, the chat it is
 * showing for the project, and the typed context the current screen offers.
 *
 * Screens publish context with {@link useAgentPanelSeed} from the persisted
 * rows they already hold (the selected issue, row or page). Nothing is read
 * from the DOM, and the server authorizes every reference when a chat starts.
 */
type Seed = { token: symbol; handoff: AgentHandoff };

type AgentPanelValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
  /** The screen's context as it was when the panel last opened. */
  seed: AgentHandoff | null;
  /** Increments on every open, so each open starts a fresh draft. */
  openCount: number;
  /** The chat the panel shows, only for the project it was started in. */
  chat: { projectId: string; chatId: string } | null;
  setChat: (chat: { projectId: string; chatId: string } | null) => void;
  publishSeed: (seed: Seed) => void;
  withdrawSeed: (token: symbol) => void;
};

const AgentPanelContext = createContext<AgentPanelValue | null>(null);

export function AgentPanelProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [openState, setOpenState] = useState(false);
  const [seed, setSeed] = useState<Seed | null>(null);
  // Snapshotted on open: a screen refetch while the panel is open must not
  // reset the draft the reader is writing.
  const [openedWith, setOpenedWith] = useState<{ seed: AgentHandoff | null; count: number }>({
    seed: null,
    count: 0,
  });
  const setOpen = useCallback(
    (next: boolean) => {
      if (next && !openState)
        setOpenedWith((current) => ({ seed: seed?.handoff ?? null, count: current.count + 1 }));
      setOpenState(next);
    },
    [openState, seed],
  );
  const [chat, setChat] = useState<AgentPanelValue['chat']>(null);
  const publishSeed = useCallback((next: Seed) => setSeed(next), []);
  // Only the screen that published the current seed may clear it, so an
  // unmounting screen never erases the context its successor just set.
  const withdrawSeed = useCallback(
    (token: symbol) => setSeed((current) => (current?.token === token ? null : current)),
    [],
  );
  const value = useMemo(
    () => ({
      open: openState,
      setOpen,
      seed: openedWith.seed,
      openCount: openedWith.count,
      chat,
      setChat,
      publishSeed,
      withdrawSeed,
    }),
    [openState, setOpen, openedWith, chat, publishSeed, withdrawSeed],
  );
  return <AgentPanelContext.Provider value={value}>{children}</AgentPanelContext.Provider>;
}

/** The panel state, or null outside the authenticated shell. */
export function useAgentPanel(): AgentPanelValue | null {
  return useContext(AgentPanelContext);
}

/**
 * Offers the current screen's typed references to the agent panel while the
 * screen is mounted. `null` offers nothing. A no-op outside the shell.
 */
export function useAgentPanelSeed(input: HandoffInput | null): void {
  const panel = useContext(AgentPanelContext);
  const publish = panel?.publishSeed;
  const withdraw = panel?.withdrawSeed;
  // A value key, so a re-render with equal references does not republish.
  const key = input ? JSON.stringify(input) : '';
  useEffect(() => {
    if (!key || !publish || !withdraw) return;
    const token = Symbol('agent-panel-seed');
    publish({ token, handoff: agentHandoff(JSON.parse(key) as HandoffInput) });
    return () => withdraw(token);
  }, [key, publish, withdraw]);
}
