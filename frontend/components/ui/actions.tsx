import {
  Button,
  buttonClasses,
  type ButtonProps,
  type ButtonVariant,
} from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { ProjectLink } from '@/components/ui/project-link';
import {
  CheckCircle2,
  Copy,
  ICONS,
  Plug,
  Plus,
  Rocket,
  Sparkles,
  type IconGlyph,
} from '@/lib/icons';
import { cn } from '@/lib/utils';

type ActionPreset = Readonly<{ label: string; variant: ButtonVariant; icon?: IconGlyph }>;

export const ACTIONS = {
  launchRun: { label: 'Launch run', variant: 'primary', icon: Rocket },
  addPrompts: { label: 'Add prompts', variant: 'secondary', icon: Plus },
  askAgent: { label: 'Ask agent', variant: 'secondary', icon: ICONS.agent },
  workWithAgent: { label: 'Work with the agent', variant: 'secondary', icon: Sparkles },
  openAction: { label: 'Open Action', variant: 'secondary', icon: ICONS.opportunities },
  viewEvidence: { label: 'View evidence', variant: 'secondary' },
  markImplemented: { label: 'Mark implemented', variant: 'secondary', icon: CheckCircle2 },
  runCrawl: { label: 'Run new crawl', variant: 'secondary' },
  connectGoogle: { label: 'Connect Google', variant: 'secondary' },
  connectCrawlLogs: { label: 'Connect crawl logs', variant: 'secondary', icon: Plug },
  copy: { label: 'Copy', variant: 'secondary', icon: Copy },
  revoke: { label: 'Revoke', variant: 'danger' },
} as const satisfies Record<string, ActionPreset>;

type ActionName = keyof typeof ACTIONS;

type ActionButtonProps = Omit<ButtonProps, 'variant' | 'asChild' | 'children'> & {
  action: ActionName;
  href?: string;
  secondary?: boolean;
};

export function ActionButton({
  action,
  href,
  secondary = false,
  className,
  ...props
}: Readonly<ActionButtonProps>) {
  const named: ActionPreset = ACTIONS[action];
  const preset: ActionPreset =
    secondary && named.variant === 'primary' ? { ...named, variant: 'secondary' } : named;
  const content = (
    <>
      {preset.icon ? <Icon icon={preset.icon} /> : null}
      {preset.label}
    </>
  );
  if (href !== undefined) {
    return (
      <ProjectLink
        href={href}
        aria-label={props['aria-label']}
        data-button-variant={preset.variant}
        className={cn(buttonClasses(preset.variant, undefined, props.size), className)}
      >
        {content}
      </ProjectLink>
    );
  }
  return (
    <Button {...props} variant={preset.variant} className={className}>
      {content}
    </Button>
  );
}
