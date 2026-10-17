/**
 * Fixture workspaces are named after their own id, which tells them apart from
 * the local app's workspaces in the shared development database.
 */
export const fixtureWorkspaceName = (id: string) => `Workspace ${id}`;

/** SQL predicate over a `workspace_id` column: the row belongs to a fixture workspace. */
export const FIXTURE_WORKSPACE_ROW = `workspace_id in (select id from workspaces where name = 'Workspace ' || id::text)`;
