export function figureText(label: string, scope: ParentNode = document): string | undefined {
  const term = [...scope.querySelectorAll('[data-figure-cell] dt')].find((dt) =>
    dt.textContent?.trim().startsWith(label),
  );
  return term?.parentElement?.querySelector('[data-figure-value]')?.textContent ?? undefined;
}
