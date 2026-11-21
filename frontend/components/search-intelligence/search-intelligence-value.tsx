import { Absence } from '@/components/ui/absence';
import { searchAmount, searchNumber } from './search-intelligence-format';

export function SearchValue({
  value,
  fetched = true,
  digits = 0,
  currency,
}: Readonly<{ value: unknown; fetched?: boolean; digits?: number; currency?: string | null }>) {
  if (!fetched) return <Absence state="not_run" label="Not fetched" />;
  const text = currency === undefined ? searchNumber(value, digits) : searchAmount(value, currency);
  return text === null ? <Absence /> : <>{text}</>;
}
