import { describe, expect, it } from 'vitest';

import { OperatorRefusal, operatorDiagnostic } from '../src/cli/operator.ts';
import { ApiError } from '../src/errors.ts';

describe('operator CLI diagnostics', () => {
  it('prints an API refusal by its declared code, never its sentence', () => {
    const refusal = new ApiError(409, 'That project was not found.', {
      code: 'agent_not_configured',
    });
    expect(operatorDiagnostic(refusal)).toBe('agent_not_configured');
  });

  it('prints reviewed text and slugs, and only the type of anything else', () => {
    expect(operatorDiagnostic(new OperatorRefusal('DATABASE_URL is required.'))).toBe(
      'DATABASE_URL is required.',
    );
    expect(operatorDiagnostic(new Error('explicit_database_required'))).toBe(
      'explicit_database_required',
    );
    expect(operatorDiagnostic(new TypeError('secret input echoed here'))).toBe('TypeError');
  });
});
