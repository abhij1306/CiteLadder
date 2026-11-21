import type { ApiKeyScope } from '@citeladder/contracts/api-keys';
import type { RouteFamily } from '@citeladder/contracts/route-ownership';
import type { z } from 'zod';

import { PRODUCT_ROUTES } from '../routes/index.ts';

type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

export type RouteContract<Family extends string = RouteFamily> = {
  family: Family;
  exposure?: 'browser' | 'public';
  scope?: ApiKeyScope;
  method: HttpMethod;
  path: string;
  pathParams?: z.ZodObject;
  query?: z.ZodObject;
  headers?: z.ZodObject;
  cookies?: z.ZodObject;
  body?: z.ZodType;
  responses: Readonly<Record<number, z.ZodType | null>>;
};

export const ROUTE_CONTRACTS: readonly RouteContract[] = PRODUCT_ROUTES.flatMap((route) =>
  route.publicContract ? [route.contract, route.publicContract] : [route.contract],
);
