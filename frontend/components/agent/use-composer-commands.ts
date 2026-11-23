import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import { attachedChars, type AgentAttachment } from '@citeladder/contracts/agent';

import type { ComposerCommands, ComposerPastes } from '@/components/agent/command-menu';
import { useToast } from '@/components/ui/toast';
import { readAttachmentFile } from '@/lib/agent/attachment-file';
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

type Prepared = { message: string; mentions: string[]; attachments: AgentAttachment[] };

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
  restore: (saved: { mentions: readonly Mention[]; pastes: readonly AgentAttachment[] }) => void;
  prepare: (draft: Draft, send: (prepared: Prepared) => void) => void;
  resolving: boolean;
  menu: ComposerMenuState;
  scope: { workspaceId: string; projectId: string };
} {
  const client = useQueryClient();
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [pastes, setPastes] = useState<ComposerPastes['items'][number][]>([]);
  const pasteCount = useRef(0);
  const keyed = (attachment: AgentAttachment) => ({
    key: `paste-${++pasteCount.current}`,
    attachment,
  });
  const toast = useToast();
  const latestMentions = useRef(mentions);
  const latestPastes = useRef(pastes);
  useEffect(() => {
    latestMentions.current = mentions;
    latestPastes.current = pastes;
  }, [mentions, pastes]);
  const [resolving, setResolving] = useState(false);
  const resolvingRef = useRef(false);
  const [reading, setReading] = useState(0);
  const pendingReads = useRef(0);
  const readGeneration = useRef(0);
  const settleRead = (change: number) => {
    pendingReads.current = Math.max(0, pendingReads.current + change);
    setReading(pendingReads.current);
  };
  const heldChars = () => attachedChars(latestPastes.current.map((paste) => paste.attachment));
  const dropReads = () => {
    readGeneration.current += 1;
    settleRead(-pendingReads.current);
  };
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
      if (resolvingRef.current || pendingReads.current > 0) return;
      const finish = (text: string) => {
        if (limits && text.length > limits.message_max_chars) {
          toast.notify(
            `Messages hold up to ${limits.message_max_chars.toLocaleString('en-US')} characters`,
            `This one has ${text.length.toLocaleString('en-US')}. Shorten it, or attach the text as a file.`,
          );
          return;
        }
        send({
          message: text,
          mentions: latestMentions.current.map((mention) => mention.id),
          attachments: latestPastes.current.map((paste) => paste.attachment),
        });
      };
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
          if (pendingReads.current === 0) finish(text);
        })
        .finally(() => {
          resolvingRef.current = false;
          setResolving(false);
        });
    },
    resolving: resolving || reading > 0,
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
          heldChars() + text.length <= limits.attachments_total_max_chars &&
          pastes.length + pendingReads.current < limits.attachments_max;
        if (fits) {
          const paste = keyed({ kind: 'pasted_text', text });
          latestPastes.current = [...latestPastes.current, paste];
          setPastes((current) => [...current, paste]);
        }
        return fits;
      },
      attach: (files) => {
        if (!limits) {
          toast.notify("Couldn't attach files yet", 'Try again in a moment.');
          return;
        }
        const room = limits.attachments_max - latestPastes.current.length - pendingReads.current;
        if (files.length > room)
          toast.notify(
            `Up to ${limits.attachments_max} attachments per message`,
            room > 0 ? `Only the first ${room} were added.` : 'Remove one to add another.',
          );
        const taken = files.slice(0, Math.max(0, room));
        const generation = readGeneration.current;
        settleRead(taken.length);
        for (const file of taken)
          void readAttachmentFile(file, limits.attachment_max_chars).then((read) => {
            if (generation !== readGeneration.current) return;
            settleRead(-1);
            if (read.kind === 'refused') {
              toast.notify(`Couldn't attach ${file.name}`, read.message);
              return;
            }
            if (heldChars() + read.attachment.text.length > limits.attachments_total_max_chars) {
              toast.notify(
                `Couldn't attach ${file.name}`,
                `Attachments in one message hold up to ${limits.attachments_total_max_chars.toLocaleString('en-US')} characters together. Remove one or attach part of the file.`,
              );
              return;
            }
            const paste = keyed(read.attachment);
            latestPastes.current = [...latestPastes.current, paste];
            setPastes((current) => [...current, paste]);
          });
      },
      remove: (key) => setPastes((current) => current.filter((paste) => paste.key !== key)),
    },
    clear: () => {
      setMentions([]);
      setPastes([]);
    },
    restore: (saved) => {
      dropReads();
      setMentions([...saved.mentions]);
      setPastes(saved.pastes.map(keyed));
    },
  };
}
export type ComposerState = ReturnType<typeof useComposerCommands>;
