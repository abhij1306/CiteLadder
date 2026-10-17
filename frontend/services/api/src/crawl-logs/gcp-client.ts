/**
 * Google Cloud access for pull sources. CiteLadder reads Pub/Sub
 * subscriptions as one dedicated reader service account
 * (`CRAWL_LOG_READER_EMAIL`), which the runtime service account impersonates
 * through IAM Credentials; no key file exists. The runtime identity comes from
 * the Google Cloud metadata server, so pull sources work only when CiteLadder
 * itself runs on Google Cloud; elsewhere leave the setting empty and the
 * connector stays hidden (log uploads and the other connectors still work).
 *
 * Plain REST over an injectable transport with bounded timeouts. Google
 * response bodies and tokens are never logged or returned.
 */
import { z } from 'zod';
import { policy, resolveSettingSpec } from '../config.ts';
import { crawlLogs } from '../config/crawl-logs.ts';
import { ApiError } from '../errors.ts';

/** The reader service account; empty means the connector is unavailable here. */
export function crawlLogReaderEmail(env: Record<string, string | undefined> = process.env) {
  return String(resolveSettingSpec(policy.settings.crawl_log_reader_email, env)).trim();
}

/**
 * What a failed call means for the customer's subscription. Failures minting
 * CiteLadder's own token are `unavailable`: they never blame the customer.
 */
export type GcpFailure = 'permission_denied' | 'not_found' | 'unavailable' | 'invalid';
export class GcpError extends Error {
  readonly failure: GcpFailure;
  constructor(failure: GcpFailure) {
    super('gcp_' + failure);
    this.failure = failure;
  }
}

const metadataToken = z.object({ access_token: z.string().min(1) });
const readerToken = z.object({ accessToken: z.string().min(1), expireTime: z.iso.datetime() });
const subscriptionSchema = z.object({
  labels: z.record(z.string(), z.string()).default({}),
  pushConfig: z.object({ pushEndpoint: z.string().optional() }).loose().default({}),
  bigqueryConfig: z.object({ table: z.string().optional() }).loose().optional(),
  cloudStorageConfig: z.object({ bucket: z.string().optional() }).loose().optional(),
  ackDeadlineSeconds: z.number().int(),
});
const pullSchema = z.object({
  receivedMessages: z
    .array(
      z.object({
        ackId: z.string().min(1),
        message: z.object({ messageId: z.string().min(1), data: z.string().default('') }).loose(),
      }),
    )
    .default([]),
});
export type GcpSubscription = z.infer<typeof subscriptionSchema>;
export type PulledMessage = { ackId: string; messageId: string; data: string };
export type PubSubReader = {
  subscription(name: string): Promise<GcpSubscription>;
  /** Up to `max` messages; an empty array only when Pub/Sub answered with none. */
  pull(name: string, max: number): Promise<PulledMessage[]>;
  acknowledge(name: string, ackIds: readonly string[]): Promise<void>;
};

const METADATA_TOKEN =
  'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';
const PUBSUB_SCOPE = 'https://www.googleapis.com/auth/pubsub';

/** 401 rejects CiteLadder's own token, so only 403 means the customer withheld access. */
function failureFor(status: number): GcpFailure {
  if (status === 403) return 'permission_denied';
  if (status === 404) return 'not_found';
  if (status === 400) return 'invalid';
  return 'unavailable';
}
/** `projects/<p>/subscriptions/<s>` with each identifier escaped for the URL path. */
function resourcePath(name: string) {
  const [, project, , subscription] = name.split('/');
  if (!project || !subscription) throw new GcpError('invalid');
  return `projects/${encodeURIComponent(project)}/subscriptions/${encodeURIComponent(subscription)}`;
}
async function json(response: Response) {
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new GcpError('unavailable');
  }
}

export function pubSubReader(options: {
  readerEmail: string;
  transport?: typeof fetch;
  now?: () => number;
}): PubSubReader {
  const send = options.transport ?? fetch;
  const now = options.now ?? Date.now;
  const settings = crawlLogs.gcp_pull;
  let cached: { token: string; refreshAt: number } | null = null;

  /**
   * Every transport failure, a timeout included, is `unavailable`: only a
   * completed empty pull may count as a drain.
   */
  async function call(url: string, init: RequestInit, timeoutSeconds: number) {
    try {
      return await send(url, {
        ...init,
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutSeconds * 1000),
      });
    } catch {
      throw new GcpError('unavailable');
    }
  }
  const bounded = settings.request_timeout_seconds;
  /** A reader token, minted from the runtime identity and reused until near expiry. */
  async function token() {
    if (cached && now() < cached.refreshAt) return cached.token;
    try {
      const runtime = await call(
        METADATA_TOKEN,
        { headers: { 'Metadata-Flavor': 'Google' } },
        bounded,
      );
      if (!runtime.ok) throw new GcpError('unavailable');
      const { access_token } = metadataToken.parse(await json(runtime));
      const minted = await call(
        `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(options.readerEmail)}:generateAccessToken`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            scope: [PUBSUB_SCOPE],
            lifetime: `${settings.token_lifetime_seconds}s`,
          }),
        },
        bounded,
      );
      if (!minted.ok) throw new GcpError('unavailable');
      const reader = readerToken.parse(await json(minted));
      cached = {
        token: reader.accessToken,
        refreshAt: Date.parse(reader.expireTime) - settings.token_refresh_margin_seconds * 1000,
      };
      return cached.token;
    } catch {
      // Our own identity failed; the customer's subscription is not at fault.
      throw new GcpError('unavailable');
    }
  }
  /** The parsed response body. */
  async function pubsub<T>(
    schema: z.ZodType<T>,
    name: string,
    action: '' | ':pull' | ':acknowledge',
    body: unknown,
    timeoutSeconds = bounded,
  ) {
    const response = await call(
      `https://pubsub.googleapis.com/v1/${resourcePath(name)}${action}`,
      {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          Authorization: `Bearer ${await token()}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
      timeoutSeconds,
    );
    if (!response.ok) {
      await response.body?.cancel();
      throw new GcpError(failureFor(response.status));
    }
    const result = schema.safeParse(await json(response));
    if (!result.success) throw new GcpError('unavailable');
    return result.data;
  }
  return {
    subscription: (name) => pubsub(subscriptionSchema, name, '', undefined),
    async pull(name, max) {
      // Pub/Sub may hold a pull open while it waits for messages, hence the longer bound.
      const body = await pubsub(
        pullSchema,
        name,
        ':pull',
        { maxMessages: max },
        settings.pull_wait_seconds,
      );
      return body.receivedMessages.map((received) => ({
        ackId: received.ackId,
        messageId: received.message.messageId,
        data: received.message.data,
      }));
    },
    async acknowledge(name, ackIds) {
      await pubsub(z.unknown(), name, ':acknowledge', { ackIds });
    },
  };
}
/** The process's reader, or 409 where no reader service account is configured. */
export function requirePubSubReader(): PubSubReader {
  const reader = defaultPubSubReader();
  if (!reader)
    throw new ApiError(409, 'The Google Cloud connector is not available in this environment');
  return reader;
}

let shared: { email: string; reader: PubSubReader } | null = null;
/** The process's reader for the configured service account, so its token cache is shared. */
export function defaultPubSubReader(): PubSubReader | null {
  const email = crawlLogReaderEmail();
  if (!email) return null;
  if (shared?.email !== email) shared = { email, reader: pubSubReader({ readerEmail: email }) };
  return shared.reader;
}
