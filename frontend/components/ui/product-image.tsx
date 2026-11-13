import { useState } from 'react';

/**
 * ProductImage — a product's picture in a record header: an 80px square on
 * `surface-sunken` with a 1px `line` border, the image contained (never
 * cropped, since a product shot is the evidence). An image that fails to load
 * draws nothing rather than a broken icon. Decorative when the header names
 * the product beside it, so its alt text is empty.
 */
export function ProductImage({ src }: Readonly<{ src: string }>) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <span className="bg-surface-sunken border-line grid size-20 shrink-0 place-items-center overflow-hidden rounded-md border">
      <img
        src={src}
        alt=""
        loading="lazy"
        className="size-full object-contain"
        onError={() => setFailed(true)}
      />
    </span>
  );
}
