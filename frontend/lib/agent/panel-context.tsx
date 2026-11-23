import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { agentHandoff, type AgentHandoff, type HandoffInput } from '@/lib/agent/handoff';

type Seed = { token: symbol; handoff: AgentHandoff };

type AgentPanelValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
  seed: AgentHandoff | null;
  openCount: number;
  chat: { projectId: string; chatId: string } | null;
  setChat: (chat: { projectId: string; chatId: string } | null) => void;
};

type AgentPanelSeedValue = {
  publishSeed: (seed: Seed) => void;
  withdrawSeed: (token: symbol) => void;
};

const AgentPanelContext = createContext<AgentPanelValue | null>(null);
const AgentPanelSeedContext = createContext<AgentPanelSeedValue | null>(null);

export function AgentPanelProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [openState, setOpenState] = useState(false);
  const seedRef = useRef<Seed | null>(null);
  const [openedWith, setOpenedWith] = useState<{ seed: AgentHandoff | null; count: number }>({
    seed: null,
    count: 0,
  });
  const setOpen = useCallback(
    (next: boolean) => {
      if (next && !openState) {
        const snapshot = seedRef.current?.handoff ?? null;
        setOpenedWith((current) => ({ seed: snapshot, count: current.count + 1 }));
      }
      setOpenState(next);
    },
    [openState],
  );
  const [chat, setChat] = useState<AgentPanelValue['chat']>(null);
  const seedValue = useMemo<AgentPanelSeedValue>(
    () => ({
      publishSeed: (next) => {
        seedRef.current = next;
      },
      withdrawSeed: (token) => {
        if (seedRef.current?.token === token) seedRef.current = null;
      },
    }),
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
    }),
    [openState, setOpen, openedWith, chat],
  );
  return (
    <AgentPanelSeedContext.Provider value={seedValue}>
      <AgentPanelContext.Provider value={value}>{children}</AgentPanelContext.Provider>
    </AgentPanelSeedContext.Provider>
  );
}

export function useAgentPanel(): AgentPanelValue | null {
  return useContext(AgentPanelContext);
}

export function useAgentPanelSeed(input: HandoffInput | null): void {
  const seeds = useContext(AgentPanelSeedContext);
  const key = input ? JSON.stringify(input) : '';
  const publish = useEffectEvent((target: AgentPanelSeedValue, token: symbol) => {
    if (input) target.publishSeed({ token, handoff: agentHandoff(input) });
  });
  useEffect(() => {
    if (!key || !seeds) return;
    const token = Symbol('agent-panel-seed');
    publish(seeds, token);
    return () => seeds.withdrawSeed(token);
  }, [key, seeds]);
}
