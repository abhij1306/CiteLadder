import { z } from 'zod';
import { record } from '../db/json.ts';
import {
  completeDiscovery,
  createDiscovery,
  discoveryRow,
  rerunDiscovery,
} from '../projects/discovery.ts';
import { discoveryComplete, discoveryCreate } from '../projects/discovery-inputs.ts';
import { changeKind, MEMBER_RUN, rowsOf, type PreviewContext } from './kind.ts';

const PROJECTS = { label: 'Open Projects', path: '/projects' };
const SPEND = "One of the day's brand discoveries; its research spends AI credits as it runs";
const discoveryPayload = z.strictObject({ discovery_id: z.uuid() });

async function discovered(context: PreviewContext, id: string) {
  const row = await discoveryRow(context.db, context.workspaceId, id);
  const input = record(row.input_data);
  return {
    status: row.status,
    brand: String(input.brand_name ?? ''),
    website: String(input.website_url ?? ''),
  };
}

export const discoveryKinds = {
  start_brand_discovery: changeKind({
    permission: MEMBER_RUN,
    purpose:
      "research a brand from its website to set up a new project; uses one of the day's brand discoveries",
    payload: discoveryCreate,
    async execute(trx, _config, actor, change, payload) {
      const discovery = await createDiscovery(trx, actor.workspaceId, payload, change.id);
      return {
        summary: 'Started the brand discovery. It runs on its own.',
        discovery: { id: discovery.id },
      };
    },
    preview(_context, payload) {
      return Promise.resolve({
        title: 'Discover a brand',
        rows: [
          { label: 'Brand', value: payload.brand_name },
          { label: 'Website', value: payload.website_url },
          { label: 'Market', value: `${payload.primary_market} · ${payload.language_code}` },
        ],
        spend: SPEND,
        opens: PROJECTS,
      });
    },
  }),
  rerun_brand_discovery: changeKind({
    permission: MEMBER_RUN,
    purpose:
      "run a finished or failed brand discovery again; uses one of the day's brand discoveries",
    payload: discoveryPayload,
    async execute(trx, _config, actor, change, payload) {
      const discovery = await rerunDiscovery(
        trx,
        actor.workspaceId,
        payload.discovery_id,
        change.id,
      );
      return {
        summary: 'Started the brand discovery again. It runs on its own.',
        discovery: { id: discovery.id },
      };
    },
    async preview(context, payload) {
      const found = await discovered(context, payload.discovery_id);
      return {
        title: 'Discover a brand again',
        rows: [
          { label: 'Brand', value: found.brand },
          { label: 'Website', value: found.website },
          { label: 'Last run', value: found.status },
        ],
        spend: SPEND,
        opens: PROJECTS,
      };
    },
  }),
  complete_brand_discovery: changeKind({
    permission: MEMBER_RUN,
    purpose:
      'create the project from a ready brand discovery with the profile, domains and competitors the person confirmed',
    payload: discoveryPayload.extend({ completion: discoveryComplete }),
    async execute(trx, _config, actor, change, payload) {
      const done = await completeDiscovery(
        trx,
        actor.workspaceId,
        actor.userId,
        payload.discovery_id,
        payload.completion,
        change.id,
      );
      return {
        summary: 'Created the project from the brand discovery.',
        project: { id: done.project_id },
      };
    },
    async preview(context, payload) {
      const found = await discovered(context, payload.discovery_id);
      const { completion } = payload;
      return {
        title: 'Create a project from a brand discovery',
        rows: [
          { label: 'Project', value: completion.name ?? found.brand },
          { label: 'Domains', value: completion.domains.join(', ') },
          {
            label: 'Competitors',
            value: completion.competitors.map((competitor) => competitor.name).join(', ') || 'none',
          },
          ...rowsOf('Category', completion.profile.category ? [completion.profile.category] : []),
        ],
        spend: null,
        opens: PROJECTS,
      };
    },
  }),
};
