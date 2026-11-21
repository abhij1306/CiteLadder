import { ProviderList } from '@/components/providers/provider-list';
import { SettingsGroup } from '@/components/ui/setting-row';

export function ProviderSettings() {
  return (
    <SettingsGroup title="Measurement providers">
      <ProviderList framed />
    </SettingsGroup>
  );
}
