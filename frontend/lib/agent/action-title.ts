import { approachLabel } from '@/lib/agent/vocabulary';
import { readableUrl, shortUrlTitle } from '@/lib/format';

export type TitledAction = Readonly<{
  target_label: string;
  approach?: string | null;
  target_kind?: string | null;
  target_url?: string | null;
}>;

function httpUrl(value: string | null | undefined): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

function pagePath(url: URL): string {
  const segments = url.pathname.split('/').filter(Boolean).map(readableUrl);
  if (segments.length === 0) return 'Home page (/)';
  if (segments.length <= 2) return `/${segments.join('/')}`;
  return `/${segments[0]}/…/${segments.at(-1)}`;
}

export function pathTail(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut > 0 ? `…${path.slice(cut)}` : path;
}

export function actionTarget(action: TitledAction): string {
  const url = httpUrl(action.target_label);
  if (action.target_kind === 'page') {
    const page = url ?? httpUrl(action.target_url);
    if (page) return pagePath(page);
  }
  return url ? shortUrlTitle(action.target_label) : readableUrl(action.target_label);
}

export function withShortTarget(text: string, action: TitledAction): string {
  if (!httpUrl(action.target_label)) return text;
  return text.replaceAll(readableUrl(action.target_label), actionTarget(action));
}

export function actionTitle(action: TitledAction, { full = false } = {}): string {
  const target = full ? readableUrl(action.target_label) : actionTarget(action);
  const work = approachLabel(action.approach);
  return work ? `${work}: ${target}` : target;
}
