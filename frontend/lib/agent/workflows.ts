/**
 * A workflow's first message: its instruction, then each filled input as a
 * labelled line. The message stays readable in the conversation and history,
 * and the server pins the workflow's skill and format from its id.
 */
import type { AgentWorkflow } from '@/lib/api/agent';

export type WorkflowValues = Readonly<Record<string, string>>;

export function workflowMessage(workflow: AgentWorkflow, values: WorkflowValues): string {
  const lines = workflow.inputs.flatMap((input) => {
    const value = values[input.key]?.trim();
    return value ? [`${input.label}: ${value}`] : [];
  });
  return [workflow.prompt, lines.join('\n')].filter(Boolean).join('\n\n');
}

/** Required inputs the reader has not filled, by key. */
export function missingInputs(workflow: AgentWorkflow, values: WorkflowValues): string[] {
  return workflow.inputs
    .filter((input) => input.required && !values[input.key]?.trim())
    .map((input) => input.key);
}
