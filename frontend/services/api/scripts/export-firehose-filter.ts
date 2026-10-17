/** Downloadable Firehose filter Lambda generated from the crawler catalog. */
import { crawlers } from '../src/config/crawlers.ts';
import { firehoseFilterSource } from './firehose-filter-source.ts';
import { writeTemplate } from './template-file.ts';

await writeTemplate(
  'citeladder-firehose-filter.mjs',
  firehoseFilterSource(crawlers),
  'crawl:firehose-filter',
);
