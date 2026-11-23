import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactNode } from 'react';

import { JUMP_LINK } from '@/components/agent/jump-link';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Inline, Stack } from '@/components/ui/layout';
import { Pressable } from '@/components/ui/pressable';
import { Textarea } from '@/components/ui/textarea';
import { textRole } from '@/components/ui/typography';
import { treeBranchClasses } from '@/components/ui/workspace';
import { Pencil, Sparkles, X } from '@/lib/icons';
import { agentWriteFailure } from '@/lib/agent/errors';
import { replaceSection, splitSections, type OutputSection } from '@/lib/agent/sections';
import {
  clearSectionDraft,
  sectionDraftKey,
  setSectionDraft,
  useSectionDraft,
} from '@/lib/agent/section-drafts';
import { agentMutations, type AgentDocumentRef, type AgentRevision } from '@/lib/api/agent';
import { useAgentLinkHosts } from '@/lib/agent/link-hosts';
import { ContentMarkdown } from '@/lib/markdown/markdown';
import { Notice } from '@/components/ui/notice';

const CONTENTS_MIN_SECTIONS = 3;

type SectionMode = { index: number; mode: 'revise' | 'edit'; revisionId: string };

export function OutputCanvas({
  workspaceId,
  target,
  revision,
  locked,
  canSend,
  onRevise,
}: Readonly<{
  workspaceId: string;
  target: AgentDocumentRef;
  revision: AgentRevision;
  locked: boolean;
  canSend: boolean;
  onRevise: (message: string) => void;
}>) {
  const sections = splitSections(revision.body);
  const [opened, setOpened] = useState<SectionMode | null>(null);
  const active = opened?.revisionId === revision.id ? opened : null;
  const titled = sections.filter((section) => section.heading !== null);
  const knownHosts = useAgentLinkHosts(revision.web_sources);
  return (
    <Stack gap="workspace">
      {titled.length >= CONTENTS_MIN_SECTIONS ? (
        <Stack as="nav" gap="tight" aria-label="Contents">
          <span className={textRole('body', 'text-ink-2')}>Contents</span>
          <Stack as="ol" gap="tight" className={treeBranchClasses()}>
            {sections.map((section, index) =>
              section.heading === null ? null : (
                <li key={section.start}>
                  <Pressable
                    className={textRole('caption', `${JUMP_LINK} w-auto`)}
                    onClick={() =>
                      document.getElementById(sectionId(revision.id, index))?.scrollIntoView?.({
                        block: 'start',
                        behavior: 'smooth',
                      })
                    }
                  >
                    {section.heading}
                  </Pressable>
                </li>
              ),
            )}
          </Stack>
        </Stack>
      ) : null}
      {sections.map((section, index) => (
        <SectionBlock
          key={`${revision.id}-${section.start}`}
          id={sectionId(revision.id, index)}
          section={section}
          knownHosts={knownHosts}
          draftKey={sectionDraftKey(target.outputId, revision.id, index)}
          mode={active?.index === index ? active.mode : null}
          locked={locked}
          canSend={canSend}
          onMode={(next) => setOpened(next ? { index, mode: next, revisionId: revision.id } : null)}
          onRevise={(instruction) => {
            setOpened(null);
            onRevise(reviseMessage(target.number, section, instruction));
          }}
          editor={
            <SectionEditor
              workspaceId={workspaceId}
              target={target}
              revision={revision}
              index={index}
              initial={section.text}
              onDone={() => setOpened((current) => (current?.index === index ? null : current))}
            />
          }
        />
      ))}
    </Stack>
  );
}

function sectionId(revisionId: string, index: number): string {
  return `output-${revisionId}-section-${index}`;
}

function sectionName(section: OutputSection): string {
  return section.heading ?? 'Introduction';
}

function reviseMessage(number: number, section: OutputSection, instruction: string): string {
  const part = section.heading === null ? 'the introduction' : `the section "${section.heading}"`;
  return `In Document ${number}, revise only ${part}: ${instruction.trim()} Keep every other section exactly as it is.`;
}

function SectionBlock({
  id,
  draftKey,
  section,
  knownHosts,
  mode: requestedMode,
  locked,
  canSend,
  onMode,
  onRevise,
  editor,
}: Readonly<{
  id: string;
  draftKey: string;
  section: OutputSection;
  knownHosts: readonly string[];
  mode: 'revise' | 'edit' | null;
  locked: boolean;
  canSend: boolean;
  onMode: (mode: 'revise' | 'edit' | null) => void;
  onRevise: (instruction: string) => void;
  editor: ReactNode;
}>) {
  const mode = useSectionDraft(draftKey) === undefined ? requestedMode : 'edit';
  if (!section.text.trim()) return null;
  const name = sectionName(section);
  return (
    <Stack as="section" gap="compact" id={id} aria-label={name} className="group scroll-mt-4">
      {mode === 'edit' ? (
        editor
      ) : (
        <ContentMarkdown markdown={section.text} density="compact" knownHosts={knownHosts} />
      )}
      {locked || mode === 'edit' ? null : (
        <Inline className="flex-wrap transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within:opacity-100 [@media(hover:hover)]:group-hover:opacity-100">
          <Button
            variant="quiet"
            disabled={!canSend}
            aria-expanded={mode === 'revise'}
            aria-label={`Ask the agent to revise ${name}`}
            onClick={() => onMode(mode === 'revise' ? null : 'revise')}
          >
            <Icon icon={Sparkles} />
            Revise
          </Button>
          <Button variant="quiet" aria-label={`Edit ${name}`} onClick={() => onMode('edit')}>
            <Icon icon={Pencil} />
            Edit
          </Button>
        </Inline>
      )}
      {mode === 'revise' ? (
        <ReviseForm name={name} onCancel={() => onMode(null)} onSubmit={onRevise} />
      ) : null}
    </Stack>
  );
}

function ReviseForm({
  name,
  onCancel,
  onSubmit,
}: Readonly<{
  name: string;
  onCancel: () => void;
  onSubmit: (instruction: string) => void;
}>) {
  const [instruction, setInstruction] = useState('');
  const inputId = `revise-${name.replaceAll(/\W+/g, '-').toLowerCase()}`;
  return (
    <Inline
      as="form"
      className="flex-wrap"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        if (instruction.trim()) onSubmit(instruction);
      }}
    >
      <label htmlFor={inputId} className="sr-only">
        How should the agent revise {name}?
      </label>
      <Input
        id={inputId}
        className="min-w-0 flex-1"
        value={instruction}
        placeholder="e.g. Add a pricing comparison table"
        onChange={(event) => setInstruction(event.target.value)}
      />
      <Button type="submit" variant="primary" disabled={!instruction.trim()}>
        Ask agent
      </Button>
      <Button type="button" variant="quiet" onClick={onCancel}>
        <Icon icon={X} />
        Cancel
      </Button>
    </Inline>
  );
}

function SectionEditor({
  workspaceId,
  target,
  revision,
  index,
  initial,
  onDone,
}: Readonly<{
  workspaceId: string;
  target: AgentDocumentRef;
  revision: AgentRevision;
  index: number;
  initial: string;
  onDone: () => void;
}>) {
  const draftKey = sectionDraftKey(target.outputId, revision.id, index);
  const text = useSectionDraft(draftKey) ?? initial;
  const setText = (next: string) => setSectionDraft(draftKey, next);
  const done = () => {
    clearSectionDraft(draftKey);
    onDone();
  };
  const save = useMutation(agentMutations.editOutput(workspaceId));
  const body = replaceSection(revision.body, index, text);
  const inputId = `section-editor-${revision.id}-${index}`;
  return (
    <Stack
      as="form"
      gap="compact"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        save
          .mutateAsync({ ...target, baseRevisionId: revision.id, title: revision.title, body })
          .then(done, () => {});
      }}
    >
      <label htmlFor={inputId} className="sr-only">
        Section text (Markdown)
      </label>
      <Textarea
        id={inputId}
        value={text}
        rows={Math.min(Math.max(text.split('\n').length + 1, 4), 16)}
        onChange={(event) => setText(event.target.value)}
      />
      {save.isError ? (
        <Notice kind="mutation" notice={agentWriteFailure(save.error, 'save the section')} />
      ) : null}
      <Inline className="justify-end">
        <Button type="button" variant="quiet" onClick={done} disabled={save.isPending}>
          <Icon icon={X} />
          Cancel
        </Button>
        <Button
          type="submit"
          variant="primary"
          disabled={body === revision.body || !body.trim() || save.isPending}
        >
          Save section
        </Button>
      </Inline>
    </Stack>
  );
}
