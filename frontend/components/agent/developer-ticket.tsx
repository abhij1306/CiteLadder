import { ClipboardList } from 'lucide-react';
import { useState } from 'react';

import { DatedEvidenceChips } from '@/components/agent/evidence-chips';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import { Dialog } from '@/components/ui/dialog';
import { Icon } from '@/components/ui/icon';
import { Stack } from '@/components/ui/layout';
import { Textarea } from '@/components/ui/textarea';
import { EditorialSectionHeader } from '@/components/ui/workspace';
import { actionEvidence } from '@/lib/agent/evidence';
import { developerTicket } from '@/lib/agent/handoff';
import type { ActionDetail } from '@/lib/api/actions';
import { useDisplayTimeZone } from '@/lib/display-timezone';
import { formatDisplayDate } from '@/lib/format';

/** The Action's records, each dated and marked observed or inferred. */
export function ActionEvidence({ action }: Readonly<{ action: ActionDetail }>) {
  const records = actionEvidence(action);
  if (records.length === 0) return null;
  return (
    <Stack as="section" aria-labelledby="action-evidence">
      <EditorialSectionHeader title="Evidence" headingId="action-evidence" />
      <DatedEvidenceChips records={records} label="Evidence records" />
    </Stack>
  );
}

/**
 * "Prepare developer ticket": the Action as copyable Markdown for a developer
 * (the issue, the affected pages, the evidence, the minimal patch and how it
 * will be verified). Built from the Action's read; nothing is sent anywhere.
 */
export function DeveloperTicketButton({ action }: Readonly<{ action: ActionDetail }>) {
  const [open, setOpen] = useState(false);
  const timeZone = useDisplayTimeZone();
  const ticket = developerTicket(action, actionEvidence(action), (iso) =>
    formatDisplayDate(iso, timeZone),
  );
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <Icon icon={ClipboardList} />
        Prepare developer ticket
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Developer ticket"
        description="Markdown for your issue tracker. Copy it and paste it into a new ticket."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Close
            </Button>
            <CopyButton value={ticket}>Copy Markdown</CopyButton>
          </>
        }
      >
        <Textarea aria-label="Developer ticket Markdown" readOnly rows={16} value={ticket} />
      </Dialog>
    </>
  );
}
