import { z } from 'zod';

// The app's CSP has no 'unsafe-eval'. Zod probes `new Function` when the first
// object schema is built, and the browser reports that blocked probe on every
// load; jitless skips it. Imported first by the entry, before any schema.
z.config({ jitless: true });
