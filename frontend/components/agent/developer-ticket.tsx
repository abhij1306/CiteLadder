import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import { Dialog } from '@/components/ui/dialog';
import { Icon } from '@/components/ui/icon';
import { Textarea } from '@/components/ui/textarea';
import { ClipboardList } from '@/lib/icons';
import { actionEvidence } from '@/lib/agent/evidence';
import { developerTicket } from '@/lib/agent/handoff';
import type { ActionDetail } from '@/lib/api/actions';
import { useDisplayTimeZone } from '@/lib/display-timezone';
import { formatDisplayDate } from '@/lib/format';

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
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Close
            </Button>
            <CopyButton variant="primary" value={ticket}>
              Copy Markdown
            </CopyButton>
          </>
        }
      >
        <Textarea aria-label="Developer ticket Markdown" readOnly rows={16} value={ticket} />
      </Dialog>
    </>
  );
}
