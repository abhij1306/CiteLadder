import { MissingValue } from '@/components/ui/unavailable-value';
import { searchNumber } from './search-intelligence-format';

/**
 * One provider figure. A dataset that was never fetched says so in words, because
 * fetching it is the reader's next step; a figure the provider did not report is
 * the shared missing mark, never a zero.
 */
export function SearchValue({
  value,
  fetched = true,
  digits = 0,
}: Readonly<{ value: unknown; fetched?: boolean; digits?: number }>) {
  if (!fetched) return <span className="value-placeholder">Not fetched</span>;
  const text = searchNumber(value, digits);
  return text === null ? <MissingValue /> : <>{text}</>;
}
