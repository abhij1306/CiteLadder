import type { BrandGlyph } from '@/components/ui/icon';

export const GoogleGlyph: BrandGlyph = (props) => {
  return (
    <svg viewBox="0 0 24 24" {...props}>
      <path
        fill="var(--color-brand-google-blue)"
        d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3h3.86c2.26-2.09 3.68-5.17 3.68-9.12z"
      />
      <path
        fill="var(--color-brand-google-green)"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z"
      />
      <path
        fill="var(--color-brand-google-yellow)"
        d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09z"
      />
      <path
        fill="var(--color-brand-google-red)"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75z"
      />
    </svg>
  );
};

export function GoogleMark() {
  return <GoogleGlyph aria-hidden className="size-6 shrink-0" />;
}
