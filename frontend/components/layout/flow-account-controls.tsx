import { ThemeSwitch } from './theme-switch';
import { UserMenuTrigger } from './user-menu';

/** The flow bar's right-hand controls: theme and the account menu. */
export function FlowAccountControls() {
  return (
    <div className="flex items-center gap-1">
      <ThemeSwitch />
      <UserMenuTrigger presenter="compact" />
    </div>
  );
}
