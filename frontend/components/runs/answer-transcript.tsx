import {
  AssistantMessage,
  ChatAvatar,
  ChatThread,
  CitationChip,
  MentionChip,
  UserMessage,
} from '@/components/ui/answer-chat';
import { BrandMark } from '@/components/ui/brand-mark';
import { EngineMark, engineMarkKey } from '@/components/ui/engine-mark';
import { Icon } from '@/components/ui/icon';
import { textRole } from '@/components/ui/typography';
import { UserRound } from '@/lib/icons';
import type { Highlight } from '@/lib/markdown/highlight';
import { ContentMarkdown, type LinkChip, type PhraseChip } from '@/lib/markdown/markdown';
import { useEngineCatalog } from '@/lib/providers/engines';
import { safeCitationUrl, type AnswerBrand, type AnswerSource } from '@/lib/runs/answer-transcript';

const listItemBlock = /^ {0,3}(?:[-*+] |\d+[.)] )/;
const structuralBlock = /^ {0,3}(?:#{1,6} |[-*+] |\d+[.)] |>|```|~~~|\|)/;
const indentedBlock = /^(?: {4}|\t)/;
const sentenceEnd = /[.!?:;\])}"'…](?:[*_~]+)?$/;
const punctuationOnly = /^[,.;:!?)\]}]+(?:[*_~]+)?$/;
const commaFragment = /^,\s/;
const sentenceFragment = /^(?:\p{Ll}|\+\d)/u;

function joinsWithoutSpace(previous: string, block: string, content: string): boolean {
  return (
    listItemBlock.test(previous) &&
    !indentedBlock.test(block) &&
    (punctuationOnly.test(content) || commaFragment.test(content))
  );
}

function joinsWithSpace(previous: string, block: string, content: string): boolean {
  return (
    listItemBlock.test(previous) &&
    !indentedBlock.test(block) &&
    !structuralBlock.test(block) &&
    !sentenceEnd.test(previous) &&
    !sentenceEnd.test(content) &&
    sentenceFragment.test(content)
  );
}

export function normalizeEvidenceMarkdown(markdown: string): string {
  const blocks = markdown
    .replaceAll('\r\n', '\n')
    .split(/\n{2,}/)
    .map((block) => block.trimEnd())
    .filter((block) => block.trim());
  const normalized: string[] = [];

  for (const block of blocks) {
    const previous = normalized.at(-1);
    if (!previous) {
      normalized.push(block);
      continue;
    }
    const blockContent = block.trimStart();
    if (joinsWithoutSpace(previous, block, blockContent)) {
      normalized[normalized.length - 1] = `${previous}${blockContent}`;
      continue;
    }
    if (joinsWithSpace(previous, block, blockContent)) {
      normalized[normalized.length - 1] = `${previous} ${blockContent}`;
      continue;
    }
    normalized.push(block);
  }

  return normalized.join('\n\n');
}

function brandChips(brands: readonly AnswerBrand[]): PhraseChip[] {
  const seen = new Set<string>();
  return brands.flatMap(({ position, ...brand }) =>
    position === null
      ? []
      : brand.phrases.flatMap((text) => {
          if (!text.trim() || seen.has(text)) return [];
          seen.add(text);
          const mark = (
            <BrandMark
              name={brand.name}
              logoUrl={brand.logoUrl}
              websiteUrl={brand.websiteUrl}
              placement="inline"
            />
          );
          const node = (
            <MentionChip
              data-brand-chip={brand.name}
              position={position}
              mark={mark}
              you={brand.you}
            >
              {text}
            </MentionChip>
          );
          return [{ text, node }];
        }),
  );
}

function sourceLinks(sources: readonly AnswerSource[]): LinkChip {
  const byHref = new Map(sources.flatMap((source) => (source.href ? [[source.href, source]] : [])));
  return (href, children) => {
    const safe = safeCitationUrl(href);
    const source = safe ? byHref.get(safe) : undefined;
    if (!source) return null;
    const mark = (
      <BrandMark
        name={source.domain || source.url}
        websiteUrl={source.href}
        placement="inline"
        entity="site"
      />
    );
    return (
      <CitationChip
        data-source-chip={source.domain}
        href={source.href}
        mark={mark}
        you={source.you}
      >
        {children}
      </CitationChip>
    );
  };
}

function EngineAvatar({ engine, label }: Readonly<{ engine: string; label: string }>) {
  const key = engineMarkKey(engine);
  return (
    <ChatAvatar tone="engine">
      {key ? (
        <EngineMark engine={key} placement="inline" />
      ) : (
        <span className={textRole('label')}>{label.slice(0, 1)}</span>
      )}
    </ChatAvatar>
  );
}

export function AnswerTranscript({
  promptText,
  engine,
  body,
  brands,
  sources,
  highlights,
}: Readonly<{
  promptText: string | null;
  engine: string;
  body: Readonly<{ kind: 'markdown'; text: string }> | Readonly<{ kind: 'note'; text: string }>;
  brands: readonly AnswerBrand[];
  sources: readonly AnswerSource[];
  highlights: readonly Highlight[];
}>) {
  const engineLabel = useEngineCatalog().label(engine);
  return (
    <ChatThread label="Conversation">
      {promptText ? (
        <UserMessage
          avatar={
            <ChatAvatar tone="you">
              <Icon icon={UserRound} />
            </ChatAvatar>
          }
        >
          <span className="sr-only">You asked: </span>
          {promptText}
        </UserMessage>
      ) : null}
      <AssistantMessage
        avatar={<EngineAvatar engine={engine} label={engineLabel} />}
        name={engineLabel}
      >
        {body.kind === 'markdown' ? (
          <ContentMarkdown
            density="compact"
            markdown={normalizeEvidenceMarkdown(body.text)}
            highlights={highlights}
            chips={brandChips(brands)}
            linkChip={sourceLinks(sources)}
          />
        ) : (
          <p className="type-body text-ink-2">{body.text}</p>
        )}
      </AssistantMessage>
    </ChatThread>
  );
}
