import { crawlers } from '../config/crawlers.ts';

type Catalog = { bots: readonly { ua_patterns: readonly string[] }[] };

const RE2_META = /[\\^$.|?*+()[\]{}]/gu;
function literal(pattern: string) {
  return pattern
    .replaceAll(RE2_META, (meta) => '\\' + meta)
    .replaceAll('\\', String.raw`\\`)
    .replaceAll('"', String.raw`\"`);
}

export function gcpLogFilter(catalog: Catalog = crawlers) {
  const patterns = [...new Set(catalog.bots.flatMap((bot) => bot.ua_patterns))]
    .sort((a, b) => a.localeCompare(b))
    .map(literal);
  return [
    '(resource.type="http_load_balancer"',
    '  OR (resource.type="cloud_run_revision" AND log_id("run.googleapis.com/requests")))',
    `AND httpRequest.userAgent=~"(?i)(${patterns.join('|')})"`,
  ].join('\n');
}
