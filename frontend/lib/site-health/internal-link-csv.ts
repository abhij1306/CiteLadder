import type { InternalLink } from '@citeladder/contracts/site-health';

import { downloadCsv } from '@/lib/csv/download';

export function downloadInternalLinksCsv(links: InternalLink[]) {
  downloadCsv(
    'internal-links',
    [
      'Source page',
      'Destination',
      'Anchor text',
      'Source passage',
      'Source analysis ID',
      'Source artifact ID',
      'Source site URL ID',
      'Source extractor version',
    ],
    links.map((link) => [
      link.source.url,
      link.target.url,
      link.anchor,
      link.placement?.text ?? '',
      link.source.analysis_id,
      link.source.artifact_id,
      link.source.site_url_id,
      link.source.extractor_version,
    ]),
  );
}
