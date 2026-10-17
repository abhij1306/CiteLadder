import { parseArgs } from 'node:util';
import { LOCAL_USER_EMAIL } from '../auth/local.ts';
import { setAcquisitionControl } from '../web-evidence/control.ts';
import { required, withOperatorDatabase } from './operator.ts';

const { values } = parseArgs({
  options: {
    actor: { type: 'string' },
    domain: { type: 'string' },
    reason: { type: 'string' },
    resume: { type: 'boolean' },
    apply: { type: 'boolean' },
    help: { type: 'boolean' },
  },
});
if (values.help)
  console.log(
    'acquisition:control --domain DOMAIN_OR_* --reason REASON [--resume] [--apply] [--actor EMAIL]',
  );
else
  await withOperatorDatabase(async (db) =>
    console.log(
      JSON.stringify(
        await setAcquisitionControl(db, {
          actor: values.actor ?? LOCAL_USER_EMAIL,
          domain: required(values.domain, 'domain'),
          reason: required(values.reason, 'reason'),
          resume: values.resume,
          apply: values.apply,
        }),
      ),
    ),
  );
