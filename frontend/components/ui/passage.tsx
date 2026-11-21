export function Passage({
  children,
  highlight,
}: Readonly<{
  children: string;
  highlight?: string;
}>) {
  const at = highlight ? children.indexOf(highlight) : -1;
  return (
    <blockquote className="bg-well rounded-control px-4 pt-4 pb-3">
      <p className="text-body-sm text-ink leading-6">
        “
        {highlight && at >= 0 ? (
          <>
            {children.slice(0, at)}
            <mark className="cl-mark">{highlight}</mark>
            {children.slice(at + highlight.length)}
          </>
        ) : (
          children
        )}
        ”
      </p>
    </blockquote>
  );
}
