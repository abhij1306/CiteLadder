export const fixtureWorkspaceName = (id: string) => `Workspace ${id}`;

export const FIXTURE_WORKSPACE_ROW = `workspace_id in (select id from workspaces where name = 'Workspace ' || id::text)`;
