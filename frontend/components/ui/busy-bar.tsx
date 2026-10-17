/**
 * Background-refresh indicator for a region whose existing content remains visible.
 * It is positioned so appearing and disappearing never shifts the retained content.
 */
export function BusyBar({ active, label }: Readonly<{ active: boolean; label: string }>) {
  if (!active) return null;
  return (
    <progress
      className="bg-neutral-bg [&::-webkit-progress-bar]:bg-neutral-bg [&::-webkit-progress-value]:bg-info [&::-moz-progress-bar]:bg-info absolute inset-x-0 top-0 z-1 h-0.5 w-full appearance-none border-0"
      aria-label={label}
    />
  );
}
