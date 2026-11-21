import { BarChart3 } from '@/lib/icons';
import { DataSourceSetup } from '@/components/integrations/data-source-setup';
import { StateBlock } from '@/components/ui/state-block';

export function AiReferralsEmptyState() {
  return (
    <DataSourceSetup
      required={['ga4']}
      title="Connect Google Analytics 4"
      whenReady={<StateBlock kind="empty" icon={BarChart3} heading="No AI-referral data yet" />}
    />
  );
}
