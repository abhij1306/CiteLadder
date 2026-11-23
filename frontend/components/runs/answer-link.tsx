import { useState, type MouseEvent, type ReactNode } from 'react';

import { AnswerDialog, type EvidenceSubject } from '@/components/runs/answer-dialog';
import {
  TextLink,
  type TextLinkText,
  type TextLinkTone,
  type TextLinkUnderline,
} from '@/components/ui/text-link';

export function useAnswerDialog(attributes = false): Readonly<{
  open: (subject: EvidenceSubject) => void;
  dialog: ReactNode;
}> {
  const [subject, setSubject] = useState<EvidenceSubject | null>(null);
  const [opened, setOpened] = useState(false);
  return {
    open: (next) => {
      setSubject(next);
      setOpened(true);
    },
    dialog: subject ? (
      <AnswerDialog
        execution={subject}
        open={opened}
        onOpenChange={setOpened}
        attributes={attributes}
      />
    ) : null,
  };
}

function isPlainClick(event: MouseEvent) {
  return (
    !event.defaultPrevented &&
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

export function AnswerLink({
  answer,
  text,
  tone,
  underline,
  attributes = false,
  children,
}: Readonly<{
  answer: Readonly<{ run_id: string; execution_id: string; prompt: string }>;
  text?: TextLinkText;
  tone?: TextLinkTone;
  underline?: TextLinkUnderline;
  attributes?: boolean;
  children: ReactNode;
}>) {
  const { open, dialog } = useAnswerDialog(attributes);
  return (
    <>
      <TextLink
        href={`/runs/${answer.run_id}?execution=${answer.execution_id}`}
        text={text}
        tone={tone}
        underline={underline}
        aria-haspopup="dialog"
        onClick={(event) => {
          if (!isPlainClick(event)) return;
          event.preventDefault();
          event.currentTarget.focus();
          open({ id: answer.execution_id, prompt_text: answer.prompt });
        }}
      >
        {children}
      </TextLink>
      {dialog}
    </>
  );
}
