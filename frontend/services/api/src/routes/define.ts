/**
 * A product route: its published contract, its parameters and its handler.
 *
 * The parameter specs are the single declaration: they validate requests
 * (`http/params.ts`) and generate the route's OpenAPI parameters. A route
 * resolves the active workspace (the default) or, with `authorize: 'project'`,
 * the project's membership:
 * the local user first, then the workspace or project (400/404), the
 * capability (403) and the parameters (422). Authorization precedes parameter validation.
 * The acting user's membership is one statement kept on the request context.
 * A route under `/projects/{project_id}` declares `authorize: 'active-project'`
 * (or, for a read with no capability, `'project'` when a link or an `<img>` must
 * open it from any workspace); its handler never re-checks the project.
 */
import type { ApiKeyScope } from '@citeladder/contracts/api-keys';
import type { Context, Hono, MiddlewareHandler } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';

import { sessionUser } from '../auth/session.ts';
import type { Permission } from '../commands/permission.ts';
import {
  activeProjectMembership,
  activeWorkspaceMembership,
  pathWorkspaceMembership,
  projectMembership,
  type MembershipRule,
  type WorkspaceCapability,
} from '../auth/workspace.ts';
import { policy, type ServiceConfig } from '../config.ts';
import type { AppEnv } from '../context.ts';
import type { Database } from '../db/database.ts';
import { ApiError, notFound } from '../errors.ts';
import { assertResponseContract } from './response-contract.ts';
import {
  validateParams,
  type ParamSpec,
  type ParamSpecs,
  type RequestParams,
} from '../http/params.ts';
import type { RouteContract } from '../openapi/routes.ts';
import { apiKeyAuth } from '../public-api/auth.ts';
import { withIdempotency } from '../public-api/idempotency.ts';

type RouteContext = { c: Context<AppEnv>; db: Database; config: ServiceConfig };

export function projectScopeOf(c: Context<AppEnv>, projectId: string) {
  return { workspaceId: c.get('workspace').workspaceId, projectId };
}

type RouteBody<Path extends ParamSpecs, Query extends ParamSpecs, Response extends z.ZodType> =
  | {
      raw?: false;
      handle: (
        context: RouteContext,
        params: RequestParams<Path, Query>,
      ) => Promise<z.input<Response>>;
    }
  | {
      raw: true;
      handle: (
        context: RouteContext,
        params: RequestParams<Path, Query>,
      ) => Promise<globalThis.Response>;
    };

type RouteSpec<Path extends ParamSpecs, Query extends ParamSpecs, Response extends z.ZodType> = {
  family: RouteContract['family'];
  path: string;
  params: { path: Path; query: Query };
  response: Response;
  method?: 'get' | 'post' | 'put' | 'patch' | 'delete';
  status?: ContentfulStatusCode | 204;
  alsoStatus?: ContentfulStatusCode;
  body?: z.ZodType;
  headers?: z.ZodObject;
  /**
   * The handler authenticates and spends attempt quota, then reads its body
   * through its own bound (compressed or not), so the app's ordinary body
   * limit must not pre-read it.
   */
  streamsBody?: true;
  authorize?: 'workspace' | 'project' | 'active-project' | 'workspace-path' | 'session' | 'public';
  exposure?: 'browser' | 'public' | 'both';
  publicPath?: string;
} & PermissionDeclaration &
  RouteBody<Path, Query, Response>;

type PermissionDeclaration = {
  permission?: Permission;
  capability?: WorkspaceCapability;
  scope?: ApiKeyScope;
};

export type ProductRoute = {
  contract: RouteContract;
  publicContract?: RouteContract;
  params: { path: ParamSpecs; query: ParamSpecs };
  streamsBody: boolean;
  register: (app: Hono<AppEnv>, config: ServiceConfig, db: Database) => void;
};

function scalarSchema(spec: ParamSpec): z.ZodType {
  const { scalar } = spec;
  switch (scalar.kind) {
    case 'uuid':
      return z.uuid();
    case 'date':
      return z.iso.date();
    case 'datetime':
      return z.iso.datetime({ offset: true });
    case 'float':
      return z.number();
    case 'bool':
      return z.boolean();
    case 'int': {
      let schema = z.int();
      if (scalar.ge !== undefined) schema = schema.min(scalar.ge);
      if (scalar.le !== undefined) schema = schema.max(scalar.le);
      return schema;
    }
    case 'str': {
      let schema = z.string();
      if (scalar.minLength !== undefined) schema = schema.min(scalar.minLength);
      if (scalar.maxLength !== undefined) schema = schema.max(scalar.maxLength);
      return schema;
    }
    case 'literal':
      return z.enum(scalar.values as [string, ...string[]]);
  }
}

function parameterObject(specs: ParamSpecs): z.ZodObject {
  const shape: Record<string, z.ZodType> = {};
  for (const [name, spec] of Object.entries(specs)) {
    const scalar = scalarSchema(spec);
    const item = spec.list ? z.array(scalar) : scalar;
    let schema: z.ZodType;
    if (spec.required) schema = item;
    else if (spec.default !== undefined) schema = item.default(spec.default);
    else schema = item.nullable().optional();
    shape[spec.alias ?? name] = spec.description ? schema.describe(spec.description) : schema;
  }
  return z.object(shape);
}

const optionalString = z.string().nullable().optional();
const ACTIVE_WORKSPACE_HEADERS = z.object({ 'x-workspace-id': optionalString });

function honoPath(path: string): string {
  return path.replaceAll(/\{([^}]+)\}/gu, ':$1'); // NOSONAR -- input is a static OpenAPI route template, never request data
}

function methodNotAllowed(method: string): never {
  throw new ApiError(405, 'Method Not Allowed', { headers: { allow: method } });
}

function routeGate(
  route: PermissionDeclaration & { path: string; authorize?: string },
  method: string,
  scoped: boolean,
): { capability: WorkspaceCapability | undefined; scope: ApiKeyScope | undefined } {
  const { permission } = route;
  if (permission && (!scoped || route.capability || route.scope))
    throw new Error(
      `A command's route resolves a workspace and declares only its permission: ${route.path}`,
    );
  const capability =
    permission?.capability ?? route.capability ?? (method === 'get' ? undefined : 'run');
  if (route.authorize === 'project' && capability !== undefined)
    throw new Error(`A gated route resolves the active workspace (active-project): ${route.path}`);
  return { capability, scope: permission?.scope ?? route.scope };
}

export function defineRoute<
  const Path extends ParamSpecs,
  const Query extends ParamSpecs,
  Response extends z.ZodType,
>(route: RouteSpec<Path, Query, Response>): ProductRoute {
  const method = route.method ?? 'get';
  const status = route.status ?? 200;
  const byProject = route.authorize === 'project';
  const activeProject = route.authorize === 'active-project';
  const publicRoute = route.authorize === 'public';
  const scoped = !publicRoute && route.authorize !== 'session';
  const workspaceHeaders =
    route.authorize === undefined || route.authorize === 'workspace' || activeProject
      ? ACTIVE_WORKSPACE_HEADERS
      : z.object({});
  const exposure = route.exposure ?? 'browser';
  const { capability, scope } = routeGate(route, method, scoped);
  const responses = {
    [status]: route.response,
    ...(route.alsoStatus ? { [route.alsoStatus]: route.response } : {}),
  };
  const shared = {
    method,
    pathParams: parameterObject(route.params.path),
    query: parameterObject(route.params.query),
    ...(route.body ? { body: route.body } : {}),
    responses,
  };
  const browser: RouteContract | null =
    exposure === 'public'
      ? null
      : {
          ...shared,
          family: route.family,
          path: route.path,
          headers: route.headers ? workspaceHeaders.extend(route.headers.shape) : workspaceHeaders,
          cookies: z.object({}),
        };
  const publicSide =
    exposure === 'browser' ? null : publicOperation({ ...route, scope }, shared, capability);
  const register = (app: Hono<AppEnv>, config: ServiceConfig, db: Database) => {
    const respond = async (c: Context<AppEnv>) => {
      if (activeProject && c.get('workspace').projectId === null) throw notFound('Project');
      if (route.permission) c.set('permission', route.permission);
      const params = validateParams(route.params, {
        path: c.req.param() as Record<string, string>,
        search: new URL(c.req.url).search,
      });
      if (route.raw) return route.handle({ c, db, config }, params);
      const body = await route.handle({ c, db, config }, params);
      if (config.appEnv === 'test')
        assertResponseContract(route.response, body, `${method.toUpperCase()} ${route.path}`);
      return c.json(body, status as ContentfulStatusCode);
    };
    if (publicSide) publicSide.register(app, config, db, respond);
    if (browser === null) return;
    const pattern = honoPath(route.path);
    let membership: MembershipRule | undefined;
    if (byProject) membership = projectMembership;
    else if (activeProject) membership = activeProjectMembership(capability);
    else if (route.authorize === 'workspace-path') membership = pathWorkspaceMembership(capability);
    else if (scoped) membership = activeWorkspaceMembership(capability);
    app.on(
      [method.toUpperCase()],
      [pattern],
      ...(method === 'get' ? [] : [sameSiteWrite]),
      ...(publicRoute ? [] : [sessionUser(config, db, membership)]),
      async (c) => {
        return respond(c);
      },
    );
  };
  const contract = browser ?? publicSide?.contract;
  if (contract === undefined) throw new Error(`Route serves no API: ${route.path}`);
  return {
    contract,
    ...(browser && publicSide ? { publicContract: publicSide.contract } : {}),
    params: route.params,
    streamsBody: route.streamsBody === true,
    register,
  };
}

function publicPathOf(route: { path: string; exposure?: string; publicPath?: string }): string {
  if (route.exposure === 'public') return route.path;
  if (route.publicPath !== undefined) {
    const projectPrefix = `${policy.api.machine_prefix}/projects/{project_id}/`;
    if (!route.publicPath.startsWith(projectPrefix))
      throw new Error(`A public path must sit below ${projectPrefix}: ${route.publicPath}`);
    return route.publicPath;
  }
  const browserPrefix = `${policy.api.prefix}/projects/{project_id}`;
  if (!route.path.startsWith(browserPrefix))
    throw new Error(`A route served on both APIs must sit below ${browserPrefix}: ${route.path}`);
  return policy.api.machine_prefix + route.path.slice(policy.api.prefix.length);
}

function publicOperation(
  route: Pick<
    RouteSpec<ParamSpecs, ParamSpecs, z.ZodType>,
    'path' | 'exposure' | 'publicPath' | 'authorize' | 'scope' | 'headers' | 'params'
  >,
  shared: Pick<RouteContract, 'method' | 'query' | 'body' | 'responses'>,
  capability: WorkspaceCapability | undefined,
) {
  const { method } = shared;
  const path = publicPathOf(route);
  if (!path.startsWith(`${policy.api.machine_prefix}/`))
    throw new Error(`A public API route must sit below ${policy.api.machine_prefix}: ${path}`);
  const anonymous = route.authorize === 'public';
  const scope = route.scope ?? (method === 'get' ? 'read' : undefined);
  if (!anonymous && scope === undefined)
    throw new Error(`A public write declares its API key scope: ${method} ${path}`);
  const guard =
    anonymous || scope === undefined ? null : { capability: capability ?? 'read', scope };
  const idempotent = guard !== null && method === 'post' && guard.scope !== 'read';
  const routeHeaders = Object.fromEntries(
    Object.entries(route.headers?.shape ?? {}).filter(
      ([name]) => name.toLowerCase() !== 'idempotency-key',
    ),
  );
  const contract: RouteContract = {
    ...shared,
    family: 'public-api',
    exposure: 'public',
    ...(guard ? { scope: guard.scope } : {}),
    path,
    pathParams: parameterObject(
      path.includes('{project_id}')
        ? { project_id: { scalar: { kind: 'uuid' }, required: true }, ...route.params.path }
        : route.params.path,
    ),
    headers: z.object({
      ...routeHeaders,
      ...(idempotent
        ? { 'Idempotency-Key': z.string().min(1).max(policy.public_api.idempotency.key_max_chars) }
        : {}),
    }),
    cookies: z.object({}),
  };
  const register = (
    app: Hono<AppEnv>,
    config: ServiceConfig,
    db: Database,
    respond: (c: Context<AppEnv>) => Promise<Response>,
  ) => {
    app.on(
      [method.toUpperCase()],
      [honoPath(path)],
      ...(guard ? [apiKeyAuth(db, config, guard)] : []),
      (c) => (idempotent ? withIdempotency(db, c, () => respond(c)) : respond(c)),
    );
  };
  return { contract, register };
}

/**
 * A browser marks a request another origin started as `Sec-Fetch-Site:
 * cross-site` or `same-site`; the product's own pages are same-origin, and
 * server-to-server callers (webhooks, CLIs) send no such header.
 */
const sameSiteWrite: MiddlewareHandler<AppEnv> = async (c, next) => {
  const site = c.req.header('sec-fetch-site');
  if (site === 'cross-site' || site === 'same-site')
    throw new ApiError(403, 'Cross-site requests are not accepted');
  await next();
};

export function defineGetRoute<
  const Path extends ParamSpecs,
  const Query extends ParamSpecs,
  Response extends z.ZodType,
>(route: RouteSpec<Path, Query, Response>): ProductRoute {
  return defineRoute(route);
}
export function definePostRoute<
  const Path extends ParamSpecs,
  const Query extends ParamSpecs,
  Response extends z.ZodType,
>(route: RouteSpec<Path, Query, Response>): ProductRoute {
  return defineRoute({ ...route, method: 'post' });
}
export function definePutRoute<
  const Path extends ParamSpecs,
  const Query extends ParamSpecs,
  Response extends z.ZodType,
>(route: RouteSpec<Path, Query, Response>): ProductRoute {
  return defineRoute({ ...route, method: 'put' });
}
export function definePatchRoute<
  const Path extends ParamSpecs,
  const Query extends ParamSpecs,
  Response extends z.ZodType,
>(route: RouteSpec<Path, Query, Response>): ProductRoute {
  return defineRoute({ ...route, method: 'patch' });
}

export function defineDeleteRoute<const Path extends ParamSpecs, const Query extends ParamSpecs>(
  route: Omit<
    RouteSpec<Path, Query, z.ZodType>,
    'method' | 'response' | 'status' | 'alsoStatus' | 'raw' | 'handle'
  > & {
    handle: (context: RouteContext, params: RequestParams<Path, Query>) => Promise<void>;
  },
): ProductRoute {
  const product = defineRoute({
    ...route,
    method: 'delete',
    status: 204,
    response: z.null(),
    raw: true,
    async handle(context, params) {
      await route.handle(context, params);
      return context.c.body(null, 204);
    },
  });
  return {
    ...product,
    contract: { ...product.contract, responses: { 204: null } },
    ...(product.publicContract
      ? { publicContract: { ...product.publicContract, responses: { 204: null } } }
      : {}),
  };
}

export function selfBoundedBodies(
  routes: readonly ProductRoute[],
): (method: string, path: string) => boolean {
  const templates = routes
    .filter((route) => route.streamsBody)
    .flatMap(({ contract, publicContract }) =>
      (publicContract ? [contract, publicContract] : [contract]).map((served) => ({
        method: served.method.toUpperCase(),
        segments: served.path.split('/'),
      })),
    );
  return (method, path) => {
    const segments = path.split('/');
    return templates.some(
      (template) =>
        template.method === method &&
        template.segments.length === segments.length &&
        template.segments.every((part, index) =>
          part.startsWith('{') ? segments[index] !== '' : part === segments[index],
        ),
    );
  };
}

export function registerMethodGuards(app: Hono<AppEnv>, routes: readonly ProductRoute[]): void {
  const methods = new Map<string, Set<string>>();
  const contracts = routes.flatMap(({ contract, publicContract }) =>
    publicContract ? [contract, publicContract] : [contract],
  );
  for (const contract of contracts) {
    const allowed = methods.get(contract.path) ?? new Set<string>();
    allowed.add(contract.method.toUpperCase());
    methods.set(contract.path, allowed);
  }
  const guards = [...methods]
    .map(([path, allowed]) => {
      const segments = path.split('/');
      const parameters = segments.filter((segment) => segment.startsWith('{')).length;
      return {
        segments: segments.map((segment) => (segment.startsWith('{') ? null : segment)),
        parameters,
        allowed,
      };
    })
    .sort((a, b) => a.parameters - b.parameters);
  app.use('*', async (c, next) => {
    // A literal route such as /competitors/discoveries takes precedence over
    // /competitors/{candidate_id}. Its GET must not inherit the latter's PATCH
    // guard. Hono's implicit HEAD remains disallowed unless explicitly declared.
    const segments = c.req.path.split('/');
    const guard = guards.find(
      (entry) =>
        entry.segments.length === segments.length &&
        entry.segments.every((segment, index) =>
          segment === null ? Boolean(segments[index]) : segment === segments[index],
        ),
    );
    if (guard && !guard.allowed.has(c.req.method)) methodNotAllowed([...guard.allowed].join(', '));
    await next();
  });
}
