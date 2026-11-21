import { SkeletonBlock } from '@/components/ui/skeleton-block';
import { textRole, type TextRole } from '@/components/ui/typography';

const LINE_WIDTH = {
  short: 'w-32',
  medium: 'w-48',
  long: 'w-64',
} as const;

export function TextLineSkeleton({
  text,
  width,
}: Readonly<{ text: TextRole; width: keyof typeof LINE_WIDTH }>) {
  return (
    <span aria-hidden className={textRole(text, 'flex h-lh items-center')}>
      <SkeletonBlock className={LINE_WIDTH[width]} />
    </span>
  );
}
