import { MissingValue } from '@/components/ui/unavailable-value';

/** A rate or mean, or the unavailable mark when nothing in scope measured it (never a zero). */
export function Measured({
  value,
  format,
}: Readonly<{ value: number | null; format: (value: number) => string }>) {
  return value === null ? <MissingValue state="unavailable" /> : format(value);
}
