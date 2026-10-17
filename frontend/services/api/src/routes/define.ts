/**
 * A product route: its published contract, its parameters and its handler.
 *
 * The parameter specs are the single declaration: they validate requests
 * (`http/params.ts`) and generate the route's OpenAPI parameters. A route
 * resolves the active workspace (the default) or, with `authorize: 'project'`,
 * the project's membership:
 * the local user first, then the workspace or project (400/404), the
 * capability (403) and the parameters (422). Authorization precedes parameter validation.
 */
import type { ApiKeyScope } from '@citeladder/contracts/api-keys';
import type { Context, Hono, MiddlewareHandler } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';

import { sessionUser } from '../auth/session.ts';
import { activeWorkspace, projectMember, workspaceMember } from '../auth/workspace.ts';
import type { WorkspaceCapability } from '../auth/workspace.ts';
import { policy, type ServiceConfig } from '../config.ts';
import type { AppEnv } from '../context.ts';
import type { Database } from '../db/database.ts';
import { ApiError } from '../errors.ts';
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

/**
 * A JSON route's handler must return what its response contract accepts, so
 * the shared contract and the handler cannot drift apart; a raw route builds
 * its own `Response` (a file download, or a status chosen per request).
 */
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
  /** Another success status the same response is served with, such as a replay's 200. */
  alsoStatus?: ContentfulStatusCode;
  body?: z.ZodType;
  headers?: z.ZodObject;
  capability?: WorkspaceCapability;
  /** Resolve the workspace from the path's `project_id` instead of `X-Workspace-Id`. */
  authorize?: 'workspace' | 'project' | 'workspace-path' | 'session' | 'public';
  /**
   * Where the route is served: the browser API (default); the public API
   * under `/v1` for API keys (`public`, declared with its `/v1` path); or
   * both, the browser path below `/api/v1/projects/{project_id}` also served
   * below `/v1`. A public call still needs `capability` from the key
   * creator's live role.
   */
  exposure?: 'browser' | 'public' | 'both';
  /**
   * The public path of a `both` route whose browser path is not below
   * `/api/v1/projects/{project_id}`: it nests the route under
   * `/v1/projects/{project_id}`, and the key middleware proves each owned path
   * ID belongs to that project (`public-api/ownership.ts`).
   */
  publicPath?: string;
  /** The API key scope a public call needs; reads default to `read`. */
  scope?: ApiKeyScope;
} & RouteBody<Path, Query, Response>;

export type ProductRoute = {
  contract: RouteContract;
  /** The public API contract of a route served on both APIs. */
  publicContract?: RouteContract;
  /** The declared parameters, as `validateParams` reads them. */
  params: { path: ParamSpecs; query: ParamSpecs };
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

/** The OpenAPI view of the parameter specs, by wire name. */
function parameterObject(specs: ParamSpecs): z.ZodObject {
  const shape: Record<string, z.ZodType> = {};
  for (const [name, spec] of Object.entries(specs)) {
    const scalar = scalarSchema(spec);
    const item = spec.list ? z.array(scalar) : scalar;
    if (spec.required) shape[spec.alias ?? name] = item;
    else if (spec.default !== undefined) shape[spec.alias ?? name] = item.default(spec.default);
    else shape[spec.alias ?? name] = item.nullable().optional();
  }
  return z.object(shape);
}

const optionalString = z.string().nullable().optional();
const ACTIVE_WORKSPACE_HEADERS = z.object({ 'x-workspace-id': optionalString });

/** An OpenAPI `{name}` path template as a Hono pattern. */
function honoPath(path: string): string {
  return path.replaceAll(/\{([^}]+)\}/gu, ':$1'); // NOSONAR -- input is a static OpenAPI route template, never request data
}

// A matched path requested with another method is 405 before any authorization runs.
function methodNotAllowed(method: string): never {
  throw new ApiError(405, 'Method Not Allowed', { headers: { allow: method } });
}

export function defineRoute<
  const Path extends ParamSpecs,
  const Query extends ParamSpecs,
  Response extends z.ZodType,
>(route: RouteSpec<Path, Query, Response>): ProductRoute {
  const method = route.method ?? 'get';
  const status = route.status ?? 200;
  const byProject = route.authorize === 'project';
  const publicRoute = route.authorize === 'public';
  const scoped = !publicRoute && route.authorize !== 'session';
  const workspaceHeaders =
    route.authorize === undefined || route.authorize === 'workspace'
      ? ACTIVE_WORKSPACE_HEADERS
      : z.object({});
  const exposure = route.exposure ?? 'browser';
  // Writes default to `run`; the capability gate precedes parameter validation.
  const capability = route.capability ?? (method === 'get' ? undefined : 'run');
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
  const publicSide = exposure === 'browser' ? null : publicOperation(route, shared, capability);
  const register = (app: Hono<AppEnv>, config: ServiceConfig, db: Database) => {
    const respond = async (c: Context<AppEnv>) => {
      const params = validateParams(route.params, {
        path: c.req.param() as Record<string, string>,
        search: new URL(c.req.url).search,
      });
      if (route.raw) return route.handle({ c, db, config }, params);
      return c.json(await route.handle({ c, db, config }, params), status as ContentfulStatusCode);
    };
    if (publicSide) publicSide.register(app, config, db, respond);
    if (browser === null) return;
    const pattern = honoPath(route.path);
    const authorize: MiddlewareHandler<AppEnv>[] = [];
    if (byProject) authorize.push(projectMember(db));
    else if (route.authorize === 'workspace-path') authorize.push(workspaceMember(db, capability));
    else if (scoped) authorize.push(activeWorkspace(db, capability));
    app.on(
      [method.toUpperCase()],
      [pattern],
      ...(method === 'get' ? [] : [sameSiteWrite]),
      ...(publicRoute ? [] : [sessionUser(config, db)]),
      ...authorize,
      async (c) => {
        if (byProject && capability !== undefined) c.get('workspace').require(capability);
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
    register,
  };
}

/** `both` serves the browser path below `/api/v1` at the same path below `/v1`. */
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

/** The public API contract and registration of a `public` or `both` route. */
function publicOperation(
  route: Pick<
    RouteSpec<ParamSpecs, ParamSpecs, z.ZodType>,
    'path' | 'exposure' | 'publicPath' | 'authorize' | 'scope' | 'headers' | 'params'
  >,
  /** The contract fields the browser and public contracts share. */
  shared: Pick<RouteContract, 'method' | 'query' | 'body' | 'responses'>,
  capability: WorkspaceCapability | undefined,
) {
  const { method } = shared;
  const path = publicPathOf(route);
  if (!path.startsWith(`${policy.api.machine_prefix}/`))
    throw new Error(`A public API route must sit below ${policy.api.machine_prefix}: ${path}`);
  // `authorize: 'public'` on a public route means anonymous (the OpenAPI document).
  const anonymous = route.authorize === 'public';
  const scope = route.scope ?? (method === 'get' ? 'read' : undefined);
  if (!anonymous && scope === undefined)
    throw new Error(`A public write declares its API key scope: ${method} ${path}`);
  const guard =
    anonymous || scope === undefined ? null : { capability: capability ?? 'read', scope };
  // Every public POST that is not a read creates or spends, so it is replay-safe.
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

/** A `204 No Content` route: the handler performs the deletion and returns nothing. */
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

/** Register once before handlers: a path may support several methods. */
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
