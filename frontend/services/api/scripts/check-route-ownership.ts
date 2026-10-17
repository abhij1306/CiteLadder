/** Check that every native route declares one manifest family and every family is served. */
import { ROUTE_FAMILIES } from '@citeladder/contracts/route-ownership';

import { policy } from '../src/config.ts';
import { openApiDocument } from '../src/openapi/document.ts';
import { routeOwnershipFailures } from '../src/openapi/ownership.ts';
import { ROUTE_CONTRACTS } from '../src/openapi/routes.ts';

const failures = routeOwnershipFailures({
  prefixes: [policy.api.prefix, policy.api.machine_prefix],
  families: ROUTE_FAMILIES,
  document: openApiDocument(ROUTE_CONTRACTS),
});

if (failures.length > 0) {
  const listing = failures.map((line) => `- ${line}`).join('\n');
  process.stderr.write(`Route ownership failed:\n${listing}\n`);
  process.exit(1);
}
process.stdout.write(`Route ownership passed: ${ROUTE_FAMILIES.length} families.\n`);
