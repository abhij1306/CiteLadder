import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { ComposerCommands, ComposerPastes, PastedText } from '@/components/agent/command-menu';
import {
  actionLinks,
  matchOptions,
  withLinkMentions,
  type CommandOption,
  type CommandToken,
  type Mention,
} from '@/lib/agent/composer-commands';
import { approachLabel } from '@/lib/agent/vocabulary';
import { useAgentCatalog } from '@/components/agent/use-agent-catalog';
import { actionsQueries } from '@/lib/api/actions';
import {
  AGENT_MENTION_SEARCH_DEBOUNCE_MS,
  AGENT_PASTE_ATTACHMENT_MIN_CHARS,
} from '@/lib/config/agent';
import { useDebounced } from '@/lib/use-debounced';

const ACTION = 'action:';

type Prepared = { message: string; mentions: string[]; attachments: PastedText[] };

type Draft = Readonly<{ message: string; edit: (change: (current: string) => string) => void }>;

export type ComposerMenuState = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  skillsOnly: boolean;
  onSelect: () => void;
  onCloseAutoFocus: (event: Event) => void;
};

export function useComposerCommands({
  workspaceId,
  projectId,
}: Readonly<{
  workspaceId: string;
  projectId: string;
}>): ComposerCommands & {
  pastes: ComposerPastes;
  clear: () => void;
  restore: (saved: { mentions: readonly Mention[]; pastes: readonly PastedText[] }) => void;
  prepare: (draft: Draft, send: (prepared: Prepared) => void) => void;
  resolving: boolean;
  menu: ComposerMenuState;
  scope: { workspaceId: string; projectId: string };
} {
  const client = useQueryClient();
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [pastes, setPastes] = useState<ComposerPastes['items'][number][]>([]);
  const pasteCount = useRef(0);
  const keyed = (text: string) => ({ key: `paste-${++pasteCount.current}`, text });
  const latestMentions = useRef(mentions);
  const latestPastes = useRef(pastes);
  useEffect(() => {
    latestMentions.current = mentions;
    latestPastes.current = pastes;
  }, [mentions, pastes]);
  const [resolving, setResolving] = useState(false);
  const resolvingRef = useRef(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [skillsOnly, setSkillsOnly] = useState(false);
  const removeCommand = useRef<(() => void) | null>(null);
  const restoreFocus = useRef<(() => void) | null>(null);
  const [search, setSearch] = useState<string | null>(null);
  const onTrigger = useCallback((trigger: CommandToken['trigger'], query: string) => {
    if (trigger === '@') setSearch(query);
  }, []);
  const searched = useDebounced(search, AGENT_MENTION_SEARCH_DEBOUNCE_MS);
  const limits = useAgentCatalog().limits;
  const mentionsMax = limits?.mentions_max ?? null;
  const actions = useQuery({
    ...actionsQueries.mentionSearch({ workspaceId, projectId }, searched ?? ''),
    enabled: searched !== null && Boolean(workspaceId && projectId),
    placeholderData: keepPreviousData,
  });

  const mentioned = new Set(mentions.map((mention) => mention.id));
  const actionOptions: CommandOption[] = (actions.data?.items ?? [])
    .filter((action) => !mentioned.has(action.id))
    .map((action) => ({
      key: `${ACTION}${action.id}`,
      label: action.target_label,
      detail: approachLabel(action.approach) ?? undefined,
      status: action.status,
      replacement: `@${action.target_label}`,
    }));

  const resolveLinks = async (text: string) => {
    const links = actionLinks(text, { origin: window.location.origin, projectId });
    const resolved = await Promise.all(
      links.map(async ({ url, actionId }) => {
        try {
          const action = await client.fetchQuery(actionsQueries.detail(workspaceId, actionId));
          return action.project_id === projectId
            ? [{ url, mention: { id: action.id, label: action.target_label } }]
            : [];
        } catch {
          return [];
        }
      }),
    );
    return resolved.flat();
  };

  const applyLinks = (text: string, resolved: Awaited<ReturnType<typeof resolveLinks>>) => {
    const next = withLinkMentions({
      text,
      mentions: latestMentions.current,
      resolved,
      max: mentionsMax ?? 0,
    });
    latestMentions.current = next.mentions;
    setMentions(next.mentions);
    return next.text;
  };

  return {
    options: (token) => {
      if (token.trigger === '/') return [];
      if (mentionsMax === null || mentions.length >= mentionsMax) return [];
      return matchOptions(actionOptions, token.query);
    },
    onTrigger,
    onPick: (option) => {
      setMentions((current) => [
        ...current,
        { id: option.key.slice(ACTION.length), label: option.label },
      ]);
    },
    onPaste: (pasted, edit) => {
      void resolveLinks(pasted).then((resolved) => {
        if (resolved.length) edit((current) => applyLinks(current, resolved));
      });
    },
    prepare: ({ message, edit }, send) => {
      if (resolvingRef.current) return;
      const finish = (text: string) =>
        send({
          message: text,
          mentions: latestMentions.current.map((mention) => mention.id),
          attachments: pasteAttachments(latestPastes.current),
        });
      if (!actionLinks(message, { origin: window.location.origin, projectId }).length) {
        finish(message);
        return;
      }
      resolvingRef.current = true;
      setResolving(true);
      void resolveLinks(message)
        .then((resolved) => {
          const text = applyLinks(message, resolved);
          if (text !== message)
            edit((current) => (current.trim() === message.trim() ? text : current));
          finish(text);
        })
        .finally(() => {
          resolvingRef.current = false;
          setResolving(false);
        });
    },
    resolving,
    mentions,
    openSkillPicker: (remove, focus) => {
      removeCommand.current = remove;
      restoreFocus.current = focus;
      setMenuOpen(true);
      setSkillsOnly(true);
    },
    closeSkillPicker: () => {
      if (!menuOpen) return false;
      setMenuOpen(false);
      removeCommand.current = null;
      return true;
    },
    menu: {
      open: menuOpen,
      onOpenChange: (open) => {
        setMenuOpen(open);
        if (open) setSkillsOnly(false);
        else removeCommand.current = null;
      },
      skillsOnly,
      onSelect: () => {
        removeCommand.current?.();
        removeCommand.current = null;
      },
      onCloseAutoFocus: (event) => {
        if (!restoreFocus.current) return;
        event.preventDefault();
        restoreFocus.current();
        restoreFocus.current = null;
      },
    },
    scope: { workspaceId, projectId },
    onRemoveMention: (id) => setMentions((current) => current.filter((item) => item.id !== id)),
    pastes: {
      items: pastes,
      add: (text) => {
        const fits =
          limits != null &&
          text.length >= AGENT_PASTE_ATTACHMENT_MIN_CHARS &&
          text.length <= limits.attachment_max_chars &&
          pastes.length < limits.attachments_max;
        if (fits) {
          const paste = keyed(text);
          setPastes((current) => [...current, paste]);
        }
        return fits;
      },
      remove: (key) => setPastes((current) => current.filter((paste) => paste.key !== key)),
    },
    clear: () => {
      setMentions([]);
      setPastes([]);
    },
    restore: (saved) => {
      setMentions([...saved.mentions]);
      setPastes(saved.pastes.map(({ text }) => keyed(text)));
    },
  };
}
export type ComposerState = ReturnType<typeof useComposerCommands>;

function pasteAttachments(pastes: ComposerPastes['items']): PastedText[] {
  return pastes.map(({ text }) => ({ kind: 'pasted_text', text }));
}
