import { useState } from 'react';

export function ProductImage({ src }: Readonly<{ src: string }>) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <span className="bg-well rounded-control grid size-20 shrink-0 place-items-center overflow-hidden">
      <img
        src={src}
        alt=""
        loading="lazy"
        data-product-photo=""
        className="size-full object-contain"
        onError={() => setFailed(true)}
      />
    </span>
  );
}
