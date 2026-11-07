/**
 * Opportunities query-key namespace. The browser reads one Opportunity at a
 * time (the evidence drawer); the catalog itself reaches screens through
 * Actions and the project command center.
 */
export const opportunityKeys = {
  all: ['opportunities'] as const,
  // A drawer knows only the Opportunity id; the workspace follows it.
  detail: (workspaceId: string | null, opportunityId: string) =>
    ['opportunities', 'detail', opportunityId, workspaceId] as const,
};
