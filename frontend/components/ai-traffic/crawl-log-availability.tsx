import type { z } from 'zod';
import type { crawlLogAvailabilitySchema } from '@citeladder/contracts/ai-traffic';
import { Notice } from '@/components/ui/notice';

/**
 * Why crawl log collection is unavailable: collection is paused on this
 * server. Nothing when available.
 */
export function CrawlLogAvailabilityNotice({
  availability,
}: Readonly<{ availability: z.infer<typeof crawlLogAvailabilitySchema> }>) {
  if (availability === 'disabled')
    return (
      <Notice tone="info">Collection is paused on this server. New log batches are refused.</Notice>
    );
  return null;
}
