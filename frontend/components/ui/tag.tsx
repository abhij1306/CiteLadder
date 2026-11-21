import type { ComponentPropsWithoutRef, ReactNode } from 'react';

import { UrlCutParts } from '@/components/ui/clamp-text';
import { ProjectLink } from '@/components/ui/project-link';
import { ArrowRight, X } from '@/lib/icons';
import { cn } from '@/lib/utils';

const TAG_FACE =
  'type-caption border border-rule text-ink-2 inline-flex min-h-5 max-w-full min-w-0 shrink-0 items-center gap-0.5 rounded-mark px-1.5 normal-nums whitespace-nowrap [[data-public-surface]_&]:min-h-[var(--tag-height)] [[data-public-surface]_&]:px-2 [[data-public-surface]_&]:bg-surface [[data-public-surface]_&]:text-ink';

type TagKind =
  | { kind?: 'category' | 'draft' }
  | {
      kind: 'removable';
      onRemove: () => void;
      removeLabel?: string;
    };

type SpanProps = Omit<ComponentPropsWithoutRef<'span'>, 'children'> & { children?: ReactNode };
type TagProps = Readonly<SpanProps & TagKind>;

function TagShell({
  kind,
  className,
  children,
  end,
  ...span
}: Readonly<SpanProps & { kind: 'category' | 'draft' | 'removable'; end?: ReactNode }>) {
  const text = typeof children === 'string' ? children : undefined;
  return (
    <span
      title={text}
      {...span}
      data-tag-kind={kind}
      className={cn(
        TAG_FACE,
        kind === 'removable' && 'pe-0.5',
        kind === 'draft' && 'border-control-line border-dashed',
        className,
      )}
    >
      {text === undefined ? children : <span className="min-w-0 truncate">{text}</span>}
      {end}
    </span>
  );
}

export function Tag(props: TagProps) {
  if (props.kind === 'removable') {
    const { kind, onRemove, removeLabel, ...span } = props;
    const text = typeof span.children === 'string' ? span.children : undefined;
    return (
      <TagShell
        {...span}
        kind={kind}
        end={
          <button
            type="button"
            aria-label={`Remove ${removeLabel ?? text ?? 'tag'}`}
            onClick={onRemove}
            className="focus-ring text-ink-2 hover:overlay-hover hover:text-ink rounded-mark hit-area grid size-4 place-items-center transition-colors"
          >
            <X className="size-3" aria-hidden />
          </button>
        }
      />
    );
  }
  const { kind = 'category', ...span } = props;
  return <TagShell {...span} kind={kind} />;
}

export function RecordTag({
  href,
  label,
  labelKind = 'text',
  status,
}: Readonly<{ href: string; label: string; labelKind?: 'text' | 'url'; status?: ReactNode }>) {
  return (
    <ProjectLink
      href={href}
      data-tag-kind="record"
      className={cn(TAG_FACE, 'hover:overlay-hover focus-ring align-middle no-underline')}
    >
      {labelKind === 'url' ? (
        <span className="flex min-w-0">
          <UrlCutParts text={label} />
        </span>
      ) : (
        <span className="min-w-0 truncate">{label}</span>
      )}
      {/* Read as two words; flex layout drops the space visually. */} {status}
      <ArrowRight className="size-3 shrink-0" aria-hidden />
    </ProjectLink>
  );
}
