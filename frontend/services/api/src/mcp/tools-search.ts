import { z } from 'zod';
import { policy } from '../config.ts';
import {
  demandSnapshot,
  researchRuns,
  integrationStatus,
  searchDataset,
  searchIntelligence,
} from './evidence.ts';
import { optional, uuid, page, project, projectTool } from './tool-definitions.ts';

export const searchTools = {
  read_demand: projectTool({
    title: 'Read search demand',
    description:
      "Read the latest search-demand snapshot: the opportunities CiteLadder found in the project's own Search Console data for one window, such as queries in striking distance of page one, pages competing for the same query, click-through below the site's norm and rising or falling queries. It returns the window (pass it to read_query_evidence for the query rows behind it), the signal count by type, each detector's state, coverage (whether search data and query evidence were observed) and the change in signal count against the previous snapshot, which is not a cause. unavailable no_demand_snapshot means no snapshot was built yet, usually because Search Console is not connected or still importing; read_integration_status says which. The signals become Actions: use read_actions for the prioritized work. Keyword volumes from research live in read_search_intelligence.",
    schema: z.strictObject(project),
    read: demandSnapshot,
  }),
  read_integration_status: projectTool({
    title: 'Read connected data',
    description:
      'Read which data sources (Search Console, GA4, server logs) are connected to the project and how far their import has got, to explain why a traffic or search read is unavailable. It returns the overall stage (not_connected, connected, importing, core_data_ready, analysis_ready or import_failed), the backfill state and the date data is imported through, whether performance and demand snapshots exist, and each connection with its provider, property and last sync. Read it when another read returns unavailable or not_connected, before reading that again. Connecting a source happens in CiteLadder, not through this tool.',
    schema: z.strictObject(project),
    read: integrationStatus,
  }),
  read_search_intelligence: projectTool({
    title: 'Read keyword and backlink research',
    description:
      "List the keyword, competitor and backlink research datasets saved for this project, and whether the research provider is connected. Each dataset has its id, kind, target domain, market (location and language), status and whether its totals are aggregates rather than individual links, plus the project's owned targets, tracked competitors and latest research run. Pass a dataset id to read_search_dataset for its rows. unavailable with no datasets means no research was run yet; this tool never starts research, which happens in CiteLadder. For the project's own Search Console queries use read_query_evidence instead. view runs lists research runs with status, newest first, including runs awaiting confirmation.",
    schema: z.strictObject({
      ...project,
      view: z
        .enum(['datasets', 'runs'])
        .default('datasets')
        .describe('datasets (the default) or runs, paged.'),
      ...page,
    }),
    read: (read, args) =>
      args.view === 'runs' ? researchRuns(read, args) : searchIntelligence(read),
  }),
  read_search_dataset: projectTool({
    title: 'Read a research dataset',
    description:
      "Read the rows of one saved keyword or backlink research dataset, after read_search_intelligence has named it. Use it for keyword volumes, rankings, competitor keywords or referring domains; use read_search_intelligence to choose the dataset and read_query_evidence for the project's own Search Console queries. It returns the dataset (kind, target, market, saved row count) and a page of rows (50 by default; pass next_cursor for more, with the same sort), each with a citeladder:// id for fetch. Columns depend on the dataset kind. Referring-domain and page totals are provider aggregates, not individual links: never report them as a link list. Rows are as saved at research time and are never refreshed by this read.",
    schema: z.strictObject({
      ...project,
      dataset_id: uuid.describe(
        'A dataset id from read_search_intelligence; a dataset of another project is refused.',
      ),
      sort: optional(
        z
          .string()
          .describe(
            `The column to order by, which must exist for the dataset kind: one of ${[...policy.search_intelligence.row_sort_fields, ...policy.search_intelligence.auxiliary_sort_fields].join(', ')}. Omit to order by row id. Rows with no value sort last.`,
          ),
      ),
      direction: z
        .enum(['asc', 'desc'])
        .default('asc')
        .describe(
          'asc (the default) or desc; desc with a volume or rank column puts the largest first.',
        ),
      ...page,
    }),
    read: searchDataset,
  }),
};
