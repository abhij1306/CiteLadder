import type { z } from 'zod';
import type { crawlLogAvailabilitySchema } from '@citeladder/contracts/ai-traffic';
import { Alert } from '@/components/ui/alert';

/**
 * Why crawl log collection is unavailable: collection is paused on this
 * server. Nothing when available.
 */
export function CrawlLogAvailabilityNotice({
  availability,
}: Readonly<{ availability: z.infer<typeof crawlLogAvailabilitySchema> }>) {
  if (availability === 'disabled')
    return (
      <Alert tone="info">
        Collection is paused on this server. Sources keep their settings and reports stay readable;
        new log batches are refused until collection resumes.
      </Alert>
    );
  return null;
}
