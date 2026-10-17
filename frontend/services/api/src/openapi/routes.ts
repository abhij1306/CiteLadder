/**
 * The route contracts the TypeScript service publishes.
 *
 * Every product route the service serves is declared here with its zod
 * schemas, and the OpenAPI document is generated from these declarations
 * (`document.ts`), which the route-ownership gate reads. Each product route
 * declares its contract beside its handler (`routes/`).
 */
import type { ApiKeyScope } from '@citeladder/contracts/api-keys';
import type { RouteFamily } from '@citeladder/contracts/route-ownership';
import type { z } from 'zod';

import { PRODUCT_ROUTES } from '../routes/index.ts';

type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

export type RouteContract<Family extends string = RouteFamily> = {
  /** The route family (OpenAPI tag) the route-ownership manifest assigns. */
  family: Family;
  /** `public`: served on the public API host under `/v1`, for API keys. */
  exposure?: 'browser' | 'public';
  /** The API key scope a public operation needs; absent for an anonymous one. */
  scope?: ApiKeyScope;
  method: HttpMethod;
  /** The OpenAPI path template, `/api/v1` (or public `/v1`) prefix included. */
  path: string;
  pathParams?: z.ZodObject;
  query?: z.ZodObject;
  headers?: z.ZodObject;
  cookies?: z.ZodObject;
  body?: z.ZodType;
  /** Success responses by status; `null` declares a response with no body. */
  responses: Readonly<Record<number, z.ZodType | null>>;
};

export const ROUTE_CONTRACTS: readonly RouteContract[] = PRODUCT_ROUTES.flatMap((route) =>
  route.publicContract ? [route.contract, route.publicContract] : [route.contract],
);
