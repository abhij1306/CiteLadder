/**
 * Workflows are the user-facing entry points to the Agent: a defined job that
 * runs one skill, optionally in one content format, from a starter message
 * and a few labelled inputs. They also own what a finished deliverable offers
 * next. Adding a deliverable type is a format and/or skill plus entries here.
 */
import { z } from 'zod';
import { policy } from '../config.ts';
import type { ContentFormat } from '../config/skill-inputs.ts';
import type { Skill } from './contracts.ts';

const id = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/u);
const text = (max: number) => z.string().trim().min(1).max(max);
const inputSchema = z.object({ key: id, label: text(60), required: z.boolean() }).strict();
const workflowSchema = z
  .object({
    id,
    group: id,
    label: text(60),
    description: text(200),
    skill_id: id,
    format_id: id.optional(),
    prompt: text(300),
    inputs: z.array(inputSchema).max(4),
  })
  .strict();
const fileSchema = z
  .object({
    groups: z.array(z.object({ id, label: text(40) }).strict()).min(1),
    workflows: z.array(workflowSchema).min(1),
    kinds: z.record(
      id,
      z
        .object({
          label: text(60),
          refinements: z.array(text(80)).max(4),
          next: z.array(z.object({ workflow: id, prompt: text(200) }).strict()).max(4),
        })
        .strict(),
    ),
  })
  .strict();

type Workflow = z.infer<typeof workflowSchema>;
export type WorkflowCatalog = z.infer<typeof fileSchema> & {
  byId: ReadonlyMap<string, Workflow>;
};

function unique(values: string[], what: string) {
  if (new Set(values).size !== values.length) throw new TypeError(`Duplicate ${what}`);
}

function checkWorkflow(
  workflow: Workflow,
  groups: ReadonlySet<string>,
  skills: ReadonlyMap<string, Skill>,
  formats: ReadonlyMap<string, ContentFormat>,
) {
  const skill = skills.get(workflow.skill_id);
  if (!skill) throw new TypeError(`Workflow ${workflow.id} names an unknown skill`);
  if (!groups.has(workflow.group))
    throw new TypeError(`Workflow ${workflow.id} names an unknown group`);
  const formatKinds: readonly string[] = policy.agent_skills.format_kinds;
  if (
    workflow.format_id &&
    (!formats.has(workflow.format_id) || !formatKinds.includes(skill.outputKind))
  )
    throw new TypeError(`Workflow ${workflow.id} names an unusable format`);
  unique(
    workflow.inputs.map((input) => input.key),
    `input in ${workflow.id}`,
  );
}

/** Every reference resolves, so a workflow can never select a missing skill or format. */
export function parseWorkflows(
  raw: string,
  skills: ReadonlyMap<string, Skill>,
  formats: ReadonlyMap<string, ContentFormat>,
): WorkflowCatalog {
  const file = fileSchema.parse(JSON.parse(raw));
  unique(
    file.groups.map((group) => group.id),
    'workflow group',
  );
  unique(
    file.workflows.map((workflow) => workflow.id),
    'workflow',
  );
  const groups = new Set(file.groups.map((group) => group.id));
  for (const workflow of file.workflows) checkWorkflow(workflow, groups, skills, formats);
  const byId = new Map(file.workflows.map((workflow) => [workflow.id, workflow]));
  const outputKinds: readonly string[] = policy.agent_skills.output_kinds;
  for (const [kind, presentation] of Object.entries(file.kinds)) {
    if (!outputKinds.includes(kind)) throw new TypeError(`Unknown output kind ${kind}`);
    for (const step of presentation.next)
      if (!byId.has(step.workflow)) throw new TypeError(`Kind ${kind} names an unknown workflow`);
  }
  return { ...file, byId };
}
