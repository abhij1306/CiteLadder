import type { Context, Hono } from 'hono';
import { z } from 'zod';
import type { ServiceConfig } from '../config.ts';
import api from '../config/api.json' with { type: 'json' };
import type { AppEnv } from '../context.ts';
import type { Database } from '../db/database.ts';
import { isRecord } from '../db/json.ts';
import { lenient, nested, opaque } from '../lenient-fields.ts';
import { loadMcpConfig, mcpPolicy } from './config.ts';
import { authenticateMcp } from './token-auth.ts';
import { admitToolCall } from './registration.ts';
import { dispatchTool, presentationTools, tools } from './tools.ts';
import { callerMessage } from './types.ts';
import { getLogger } from '../logging.ts';
import { parseUuid } from '../http/uuid.ts';
import { appResource, appToolMetadata, readAppResource } from './app-resource.ts';
const logger = getLogger('mcp');

const VERSIONS = ['2026-07-28', '2025-11-25'];
const INSTRUCTIONS = [
  "CiteLadder data about a business's visibility in AI answers and search.",
  'Start with list_projects, then get_project_business_context; use the focused reads for detail.',
  'Missing evidence is unavailable, never zero. Report change without claiming its cause.',
  'IDs and citeladder:// references are for your tool calls only: never show them to the user. Name the page, prompt, competitor or Action instead, and give app links as links.',
].join(' ');
const toolNames = new Set(tools.map((tool) => tool.name));
const listedTools = tools.map((tool) =>
  presentationTools.has(tool.name) ? { ...tool, _meta: appToolMetadata } : tool,
);
const CAPABILITIES = { tools: {}, resources: {}, prompts: {} };
const VERSION_KEY = 'io.modelcontextprotocol/protocolVersion';
const clientInfoSchema = z.object({ name: z.string(), version: z.string() });
const metaSchema = nested({
  [VERSION_KEY]: opaque,
  'io.modelcontextprotocol/clientInfo': lenient(
    (value) => clientInfoSchema.safeParse(value).success,
  ),
  'io.modelcontextprotocol/clientCapabilities': lenient(isRecord),
}).transform((meta) => ({
  version: meta[VERSION_KEY],
  described:
    meta['io.modelcontextprotocol/clientInfo'] &&
    meta['io.modelcontextprotocol/clientCapabilities'],
}));
const paramsSchema = z.object({ name: opaque, uri: opaque, arguments: opaque, _meta: metaSchema });
const rpcMessageSchema = z.object({
  jsonrpc: z.literal('2.0'),
  method: z.string(),
  id: z.union([z.string(), z.int()]).optional(),
  params: paramsSchema.optional(),
});
const toolCallSchema = z.object({
  name: z.string(),
  arguments: z.record(z.string(), z.unknown()).optional(),
});
const promptCallSchema = z.object({
  name: z.literal('business_health_review'),
  arguments: z.object({ project_id: z.string().refine((id) => parseUuid(id) !== null) }),
});
function origin(value: string): string | null {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === '/'
      ? url.origin
      : null;
  } catch {
    return null;
  }
}
function rpcError(id: unknown, code: number, message: string, data?: unknown) {
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    error: { code, message, ...(data === undefined ? {} : { data }) },
  };
}
function decodedHeader(value: string | undefined): string | undefined {
  if (!value?.startsWith('=?base64?') || !value.endsWith('?=')) return value;
  const encoded = value.slice(9, -2);
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(encoded))
    return undefined;
  return Buffer.from(encoded, 'base64').toString('utf8');
}

type McpContext = Context<AppEnv>;
type McpSettings = ReturnType<typeof loadMcpConfig>;
type McpPrincipalGrant = NonNullable<Awaited<ReturnType<typeof authenticateMcp>>>;
type RpcMessage = z.output<typeof rpcMessageSchema>;
type RpcParams = z.output<typeof paramsSchema>;
type McpCall = {
  c: McpContext;
  db: Database;
  settings: McpSettings;
  principal: McpPrincipalGrant;
  message: RpcMessage;
  params: RpcParams;
  modern: boolean;
};
type MethodResult = Record<string, unknown> | Response;

const BODY_TOO_LARGE = 'Request body too large.';

/** A browser-sent request must come from the server's own host (DNS rebinding). */
function requestOriginPermitted(c: McpContext) {
  const supplied = c.req.header('origin');
  if (!supplied) return true;
  const host = c.req.header('host') ?? new URL(c.req.url).host;
  const allowed = origin(supplied);
  return allowed !== null && new URL(allowed).host === host.toLowerCase();
}
function declaredBodyTooLarge(c: McpContext) {
  const declared = c.req.header('content-length');
  return (
    declared !== undefined &&
    (!/^\d+$/u.test(declared) || Number(declared) > api.request_body_max_bytes)
  );
}
async function exceedsBodyLimit(reader: ReadableStreamDefaultReader<Uint8Array>) {
  let bytes = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) return false;
      bytes += part.value.byteLength;
      if (bytes > api.request_body_max_bytes) {
        void reader.cancel();
        return true;
      }
    }
  } finally {
    reader.releaseLock();
  }
}
async function bodyTooLarge(c: McpContext) {
  if (declaredBodyTooLarge(c)) return true;
  // Bounded clone leaves the original body available to the tool owners.
  const reader = c.req.raw.clone().body?.getReader();
  return reader ? exceedsBodyLimit(reader) : false;
}

function unauthorized(c: McpContext) {
  const rejected = c.req.header('authorization') ? ', error="invalid_token"' : '';
  // RFC 6750 §3: a presented but rejected token is invalid_token.
  c.header('WWW-Authenticate', `Bearer realm="citeladder"${rejected}`);
  return c.json(
    { error: 'invalid_token', error_description: 'Send MCP_TOKEN as the bearer token.' },
    401,
  );
}
function transportRefusal(c: McpContext): Response | null {
  if (c.req.method !== 'POST') {
    c.header('Allow', 'POST');
    return c.text('Method not allowed', 405);
  }
  const accept = c.req.header('accept') ?? '';
  if (!accept.includes('application/json') || !accept.includes('text/event-stream'))
    return c.json(
      rpcError(null, -32600, 'Accept must include application/json and text/event-stream'),
      406,
    );
  if (c.req.header('content-type')?.split(';')[0]?.trim() !== 'application/json')
    return c.json(rpcError(null, -32600, 'Content-Type must be application/json'), 415);
  return null;
}
async function readMessage(c: McpContext): Promise<RpcMessage | Response> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(rpcError(null, -32700, 'Parse error'), 400);
  }
  const message = rpcMessageSchema.safeParse(body);
  return message.success ? message.data : c.json(rpcError(null, -32600, 'Invalid request'), 400);
}
function modernHeadersRefusal(
  c: McpContext,
  message: RpcMessage,
  params: RpcParams,
): Response | null {
  const headerVersion = c.req.header('mcp-protocol-version');
  if (
    headerVersion !== params._meta.version ||
    c.req.header('mcp-method') !== message.method ||
    (['tools/call', 'prompts/get', 'resources/read'].includes(message.method) &&
      decodedHeader(c.req.header('mcp-name')) !== (params.name ?? params.uri))
  )
    return c.json(rpcError(message.id, -32020, 'Request headers do not match body metadata'), 400);
  if (!params._meta.described)
    return c.json(rpcError(message.id, -32602, 'Required client metadata is missing'), 400);
  return null;
}
function negotiateVersion(
  c: McpContext,
  message: RpcMessage,
  params: RpcParams,
): { modern: boolean } | Response {
  const headerVersion = c.req.header('mcp-protocol-version');
  const requestedVersion = params._meta.version ?? headerVersion;
  const modern = requestedVersion === VERSIONS[0] || headerVersion === VERSIONS[0];
  if (requestedVersion !== undefined && !VERSIONS.includes(String(requestedVersion)))
    return c.json(
      rpcError(message.id, -32022, 'Unsupported protocol version', {
        supported: VERSIONS,
        requested: requestedVersion,
      }),
      400,
    );
  return (modern ? modernHeadersRefusal(c, message, params) : null) ?? { modern };
}

const serverInfo = {
  name: 'citeladder',
  title: 'CiteLadder Business Context',
  version: mcpPolicy.server_version,
  websiteUrl: mcpPolicy.documentation_url,
};

function initialize({ c, message, modern }: McpCall): MethodResult {
  if (modern) return c.json(rpcError(message.id, -32601, 'Method not found'), 404);
  return {
    protocolVersion: VERSIONS[1],
    capabilities: CAPABILITIES,
    serverInfo,
    instructions: INSTRUCTIONS,
  };
}
async function callTool(call: McpCall): Promise<MethodResult> {
  const { c, db, settings, principal, message } = call;
  const parsed = toolCallSchema.safeParse(call.params);
  if (!parsed.success) return c.json(rpcError(message.id, -32602, 'Invalid tool arguments'), 400);
  const { name } = parsed.data;
  if (!toolNames.has(name))
    return c.json(rpcError(message.id, -32602, `Unknown tool: ${name}`), 400);
  try {
    await admitToolCall(db, principal.grantId, principal.userId);
    const args = parsed.data.arguments ?? {};
    const value = await dispatchTool(db, principal, name, args, settings.browserOrigin);
    return {
      content: [{ type: 'text', text: JSON.stringify(value) }],
      structuredContent: value,
      isError: false,
      ...(presentationTools.has(name) ? { _meta: appToolMetadata } : {}),
    };
  } catch (error) {
    return toolFailure(error, name);
  }
}
function toolFailure(error: unknown, name: string): MethodResult {
  const problem = callerMessage(error);
  if (problem === null)
    logger.warning('MCP tool call failed', {
      tool: name,
      exceptionType: error instanceof Error ? error.name : 'unknown',
    });
  return {
    content: [{ type: 'text', text: problem ?? 'Evidence is unavailable.' }],
    isError: true,
  };
}
async function readResource({ c, db, settings, principal, message, params }: McpCall) {
  if (params.uri === appResource.uri) return readAppResource();
  const match =
    typeof params.uri === 'string'
      ? /^citeladder:\/\/projects\/([^/]+)\/context$/u.exec(params.uri)
      : null;
  if (!match) return c.json(rpcError(message.id, -32602, 'Unknown resource'), 400);
  try {
    const value = await dispatchTool(
      db,
      principal,
      'get_project_business_context',
      { project_id: match[1] },
      settings.browserOrigin,
    );
    return {
      contents: [{ uri: params.uri, mimeType: 'application/json', text: JSON.stringify(value) }],
    };
  } catch (error) {
    if (callerMessage(error) !== null)
      return c.json(rpcError(message.id, -32602, 'Resource not found'), 400);
    logger.warning('MCP resource read failed', {
      exceptionType: error instanceof Error ? error.name : 'unknown',
    });
    return c.json(rpcError(message.id, -32603, 'Resource is unavailable'), 500);
  }
}
function getPrompt({ c, message, params }: McpCall): MethodResult {
  const parsed = promptCallSchema.safeParse(params);
  if (!parsed.success) return c.json(rpcError(message.id, -32602, 'Invalid prompt arguments'), 400);
  const args = parsed.data.arguments;
  return {
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: `Review project ${args.project_id} with get_project_business_context: what its AI visibility is, what holds it back and which Actions come first. Keep unavailable evidence distinct from zero, do not claim causes, and show no IDs.`,
        },
      },
    ],
  };
}
async function dispatchMethod(call: McpCall): Promise<MethodResult> {
  const { c, message, modern } = call;
  switch (message.method) {
    case 'initialize':
      return initialize(call);
    case 'server/discover':
      return {
        supportedVersions: VERSIONS,
        capabilities: CAPABILITIES,
        instructions: INSTRUCTIONS,
        _meta: { 'io.modelcontextprotocol/serverInfo': serverInfo },
      };
    case 'ping':
      return {};
    case 'tools/list':
      return { tools: listedTools };
    case 'tools/call':
      return callTool(call);
    case 'resources/list':
      return { resources: [appResource] };
    case 'resources/templates/list':
      return {
        resourceTemplates: [
          {
            uriTemplate: 'citeladder://projects/{project_id}/context',
            name: 'project-business-context',
            title: 'Project business context',
            mimeType: 'application/json',
          },
        ],
      };
    case 'resources/read':
      return readResource(call);
    case 'prompts/list':
      return {
        prompts: [
          {
            name: 'business_health_review',
            title: 'Review company growth health',
            arguments: [{ name: 'project_id', required: true }],
          },
        ],
      };
    case 'prompts/get':
      return getPrompt(call);
    default:
      return c.json(rpcError(message.id, -32601, 'Method not found'), modern ? 404 : 200);
  }
}
function cacheHint(method: string, params: RpcParams) {
  const { catalogue, grant, project } = mcpPolicy.result_cache;
  switch (method) {
    case 'server/discover':
    case 'resources/list':
    case 'resources/templates/list':
    case 'prompts/list':
      return catalogue;
    case 'tools/list':
      return grant;
    case 'resources/read':
      return params.uri === appResource.uri ? catalogue : project;
    default:
      return {};
  }
}
async function handleMcpRequest(
  c: McpContext,
  db: Database,
  config: ServiceConfig,
  settings: McpSettings,
) {
  const principal = await authenticateMcp(db, config, c.req.raw, settings);
  if (!principal) return unauthorized(c);
  const refusal = transportRefusal(c);
  if (refusal) return refusal;
  const message = await readMessage(c);
  if (message instanceof Response) return message;
  const params = message.params ?? paramsSchema.parse({});
  const version = negotiateVersion(c, message, params);
  if (version instanceof Response) return version;
  if (message.id === undefined) return c.body(null, 202);
  const { modern } = version;
  const result = await dispatchMethod({
    c,
    db,
    settings,
    principal,
    message,
    params,
    modern,
  });
  if (result instanceof Response) return result;
  return c.json({
    jsonrpc: '2.0',
    id: message.id,
    result: modern
      ? { ...result, resultType: 'complete', ...cacheHint(message.method, params) }
      : result,
  });
}

export function registerMcpRoutes(app: Hono<AppEnv>, config: ServiceConfig, db: Database): void {
  const settings = loadMcpConfig(config);
  for (const path of ['/mcp', '/mcp/'])
    app.use(path, async (c, next) => {
      if (!settings.enabled) return c.notFound();
      if (!requestOriginPermitted(c)) return c.text('Invalid MCP request origin.', 403);
      c.header('Cache-Control', 'no-store');
      if (await bodyTooLarge(c)) return c.text(BODY_TOO_LARGE, 413);
      await next();
    });
  for (const path of ['/mcp', '/mcp/'])
    app.all(path, (c) => handleMcpRequest(c, db, config, settings));
}
