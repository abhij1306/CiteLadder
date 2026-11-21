import { z } from 'zod';

const CLIENT_ERROR_KINDS = ['chunk_load', 'render', 'route', 'unhandled'] as const;
export type ClientErrorKind = (typeof CLIENT_ERROR_KINDS)[number];

export const CLIENT_ERROR_FIELD_LIMITS = {
  message: 500,
  stack: 4000,
  route: 512,
  release: 64,
  component: 64,
  script: 512,
  invoker: 128,
} as const;

export const SLOW_INTERACTION_SCRIPT_LIMIT = 3;

const limits = CLIENT_ERROR_FIELD_LIMITS;
const noQuery = /^[^?#\s]*$/u;
const milliseconds = z.number().int().min(0).max(600_000);

const route = z
  .string()
  .max(limits.route)
  .regex(/^\/[^?#\s]*$/u);
const release = z
  .string()
  .min(1)
  .max(limits.release)
  .regex(/^[\w.-]+$/u);

const errorReportSchema = z.strictObject({
  kind: z.enum(CLIENT_ERROR_KINDS),
  message: z.string().min(1).max(limits.message),
  stack: z.string().max(limits.stack).nullable(),
  route,
  release,
  component: z
    .string()
    .min(1)
    .max(limits.component)
    .regex(/^[\w-]+$/u)
    .optional(),
});

const slowInteractionReportSchema = z.strictObject({
  kind: z.literal('slow_interaction'),
  route,
  release,
  event: z.string().regex(/^[a-z]{1,32}$/u),
  target: z
    .string()
    .regex(/^[a-z][a-z0-9-]{0,63}$/u)
    .nullable(),
  duration_ms: milliseconds,
  input_delay_ms: milliseconds,
  processing_ms: milliseconds,
  presentation_ms: milliseconds,
  scripts: z
    .array(
      z.strictObject({
        source: z.string().max(limits.script).regex(noQuery),
        invoker: z
          .string()
          .max(limits.invoker)
          .regex(/^[^?\s]*$/u),
        duration_ms: milliseconds,
      }),
    )
    .max(SLOW_INTERACTION_SCRIPT_LIMIT),
});
export type SlowInteractionReport = z.infer<typeof slowInteractionReportSchema>;

export const clientReportSchema = z.discriminatedUnion('kind', [
  errorReportSchema,
  slowInteractionReportSchema,
]);
export type ClientReport = z.infer<typeof clientReportSchema>;

const CSP_REPORT_BATCH_LIMIT = 20;

const reportUrl = z.string().max(2048);

/**
 * One `csp-violation` report as the Reporting API sends it. Fields a browser
 * adds beyond these are dropped. Of `sample`, which can hold page text or
 * code, only a Trusted Types sink name (`Element innerHTML` before the `|`) is kept.
 */
const cspViolationSchema = z.object({
  type: z.literal('csp-violation'),
  body: z.object({
    documentURL: reportUrl,
    blockedURL: reportUrl.optional(),
    effectiveDirective: z.string().max(64),
    disposition: z.enum(['enforce', 'report']),
    sourceFile: reportUrl.nullish(),
    lineNumber: z.number().int().nonnegative().nullish(),
    columnNumber: z.number().int().nonnegative().nullish(),
    sample: z
      .string()
      .max(256)
      .optional()
      .transform((value) => /^([A-Za-z]{1,40}(?: [A-Za-z]{1,40})?)\|/u.exec(value ?? '')?.[1]),
  }),
});

const otherReportSchema = z.object({
  type: z
    .string()
    .max(64)
    .refine((type) => type !== 'csp-violation'),
});

export const cspReportBatchSchema = z
  .array(z.union([cspViolationSchema, otherReportSchema]))
  .min(1)
  .max(CSP_REPORT_BATCH_LIMIT);

export function withoutQueryStrings(text: string): string {
  return text.replaceAll(/[^\s'"`()<>]+/gu, (word) => {
    const position = /(?::\d+){1,2}$/u.exec(word)?.[0] ?? '';
    const address = word.slice(0, word.length - position.length);
    const cut = address.search(/[?#]/u);
    if (cut === -1) return word;
    const head = address.slice(0, cut);
    const urlLike = head.includes('/') || address.slice(cut + 1).includes('=');
    return urlLike ? head + position : word;
  });
}
