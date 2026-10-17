'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil, Sparkles } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Pressable } from '@/components/ui/pressable';
import { Textarea } from '@/components/ui/textarea';
import { textRole } from '@/components/ui/typography';
import { agentWriteFailure } from '@/lib/agent/errors';
import { replaceSection, splitSections, type OutputSection } from '@/lib/agent/sections';
import { agentMutations, type AgentRevision } from '@/lib/api/agent';
import { queryKeys } from '@/lib/api/query-keys';
import { ContentMarkdown } from '@/lib/markdown/markdown';

/** Outputs with at least this many titled sections get a contents list. */
const CONTENTS_MIN_SECTIONS = 3;

type SectionMode = { index: number; mode: 'revise' | 'edit' } | null;

/**
 * The output as a document the reader works on section by section. A section
 * can be edited in place (saved as a new user revision with every other
 * section unchanged) or sent to the agent with an instruction, which is an
 * ordinary follow-up turn. Both are refused while a turn is running.
 */
export function OutputCanvas({
  workspaceId,
  chatId,
  revision,
  locked,
  canSend,
  onRevise,
}: Readonly<{
  workspaceId: string;
  chatId: string;
  revision: AgentRevision;
  locked: boolean;
  canSend: boolean;
  onRevise: (message: string) => void;
}>) {
  const sections = splitSections(revision.body);
  const [active, setActive] = useState<SectionMode>(null);
  const titled = sections.filter((section) => section.heading !== null);
  return (
    <div className="grid gap-4">
      {titled.length >= CONTENTS_MIN_SECTIONS ? (
        <nav aria-label="Contents" className="grid gap-1">
          <span className={textRole('label')}>Contents</span>
          <ol className="grid gap-1 ps-4">
            {sections.map((section, index) =>
              section.heading === null ? null : (
                <li key={section.start}>
                  <Pressable
                    className={textRole('caption', 'hover:text-accent-text w-auto')}
                    onClick={() =>
                      document
                        .getElementById(sectionId(revision.id, index))
                        ?.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
                    }
                  >
                    {section.heading}
                  </Pressable>
                </li>
              ),
            )}
          </ol>
        </nav>
      ) : null}
      {sections.map((section, index) => (
        <SectionBlock
          key={`${revision.id}-${section.start}`}
          id={sectionId(revision.id, index)}
          section={section}
          mode={active?.index === index ? active.mode : null}
          locked={locked}
          canSend={canSend}
          onMode={(mode) => setActive(mode ? { index, mode } : null)}
          onRevise={(instruction) => {
            setActive(null);
            onRevise(reviseMessage(section, instruction));
          }}
          editor={
            <SectionEditor
              workspaceId={workspaceId}
              chatId={chatId}
              revision={revision}
              index={index}
              initial={section.text}
              onDone={() => setActive(null)}
            />
          }
        />
      ))}
    </div>
  );
}

function sectionId(revisionId: string, index: number): string {
  return `output-${revisionId}-section-${index}`;
}

function sectionName(section: OutputSection): string {
  return section.heading ?? 'Introduction';
}

function reviseMessage(section: OutputSection, instruction: string): string {
  const target = section.heading === null ? 'the introduction' : `the section "${section.heading}"`;
  return `Revise only ${target}: ${instruction.trim()} Keep every other section exactly as it is.`;
}

function SectionBlock({
  id,
  section,
  mode,
  locked,
  canSend,
  onMode,
  onRevise,
  editor,
}: Readonly<{
  id: string;
  section: OutputSection;
  mode: 'revise' | 'edit' | null;
  locked: boolean;
  canSend: boolean;
  onMode: (mode: 'revise' | 'edit' | null) => void;
  onRevise: (instruction: string) => void;
  editor: ReactNode;
}>) {
  if (!section.text.trim()) return null;
  const name = sectionName(section);
  return (
    <section id={id} aria-label={name} className="group grid scroll-mt-4 gap-2">
      {mode === 'edit' ? editor : <ContentMarkdown markdown={section.text} density="compact" />}
      {locked || mode === 'edit' ? null : (
        // Quiet until the section is hovered or focused; always shown on touch.
        <div className="flex flex-wrap gap-2 transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within:opacity-100 [@media(hover:hover)]:group-hover:opacity-100">
          <Button
            variant="ghost"
            size="sm"
            disabled={!canSend}
            aria-expanded={mode === 'revise'}
            aria-label={`Ask the agent to revise ${name}`}
            onClick={() => onMode(mode === 'revise' ? null : 'revise')}
          >
            <Sparkles className="size-3.5" aria-hidden />
            Revise
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Edit ${name}`}
            onClick={() => onMode('edit')}
          >
            <Pencil className="size-3.5" aria-hidden />
            Edit
          </Button>
        </div>
      )}
      {mode === 'revise' ? (
        <ReviseForm name={name} onCancel={() => onMode(null)} onSubmit={onRevise} />
      ) : null}
    </section>
  );
}

function ReviseForm({
  name,
  onCancel,
  onSubmit,
}: Readonly<{ name: string; onCancel: () => void; onSubmit: (instruction: string) => void }>) {
  const [instruction, setInstruction] = useState('');
  const inputId = `revise-${name.replaceAll(/\W+/g, '-').toLowerCase()}`;
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
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
      <Button type="submit" size="sm" disabled={!instruction.trim()}>
        Ask agent
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
        Cancel
      </Button>
    </form>
  );
}

/**
 * An edit of one section, saved on top of the revision it started from; the
 * server refuses it if the output moved on meanwhile, and the text stays.
 */
function SectionEditor({
  workspaceId,
  chatId,
  revision,
  index,
  initial,
  onDone,
}: Readonly<{
  workspaceId: string;
  chatId: string;
  revision: AgentRevision;
  index: number;
  initial: string;
  onDone: () => void;
}>) {
  const [text, setText] = useState(initial);
  const queryClient = useQueryClient();
  const save = useMutation({
    ...agentMutations.editOutput(workspaceId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.agent.chat(chatId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.agent.revisions(chatId) }),
      ]);
      onDone();
    },
  });
  const body = replaceSection(revision.body, index, text);
  const inputId = `section-editor-${revision.id}-${index}`;
  return (
    <form
      className="grid gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate({ chatId, baseRevisionId: revision.id, title: revision.title, body });
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
      {save.isError ? <Alert tone="danger">{agentWriteFailure(save.error).message}</Alert> : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onDone} disabled={save.isPending}>
          Cancel
        </Button>
        <Button
          type="submit"
          size="sm"
          disabled={body === revision.body || !body.trim() || save.isPending}
        >
          Save section
        </Button>
      </div>
    </form>
  );
}
