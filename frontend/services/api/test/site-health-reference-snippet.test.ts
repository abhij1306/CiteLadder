import { describe, expect, it } from 'vitest';

import { policy } from '../src/config.ts';
import { bodyFacts } from './site-health-fixtures.ts';

const cap = policy.site_health.page_analysis.facts.limits.reference_snippet_chars;

/** The reference snippet the extractor keeps for a page whose body is `body`. */
const snippetOf = (body: string) =>
  bodyFacts(body).accessibility.controls_missing_accessible_name_snippet;

describe('the reference snippet of an unnamed control', () => {
  it('keeps structure and redacts text, values, secrets, handlers and scripts', () => {
    expect(
      snippetOf(
        '<form><div class="row" data-user="jo@example.com"><!-- note -->' +
          '<b>Card number</b> <input type="text" id="card" name="cc" value="4111111111111111"' +
          ' placeholder="Your name" autocomplete="cc-number" onfocus="leak()" required' +
          ' class="sess-3f9a1c7e2b8d4f6a9c0e1b2d"><style>.x{}</style><script>steal()</script>' +
          '<svg aria-hidden="true"><path d="M0 0"></path></svg></div></form>',
      ),
    ).toEqual({
      html:
        '<div class="row" data-user="[redacted]"><b>[text]</b><input type="text" id="card"' +
        ' name="cc" value="[redacted]" placeholder="[redacted]" autocomplete="cc-number"' +
        ' required class="[redacted]"><svg aria-hidden="true"></svg></div>',
      truncated: false,
    });
  });

  it('takes the wrapping label as context and only the first unnamed control', () => {
    expect(
      snippetOf(
        '<label for="other"><i>Hint</i><select name="size"></select></label><textarea></textarea>',
      ),
    ).toEqual({
      html: '<label for="other"><i>[text]</i><select name="size"></select></label>',
      truncated: false,
    });
    expect(snippetOf('<label>Email <input type="email"></label>')).toBeNull();
  });

  it('redacts an address in a kept attribute and keeps a plain one', () => {
    expect(snippetOf('<p><input name="jo.smith@example.co.uk" id="contact-field.v2"></p>')).toEqual(
      {
        html: '<p><input name="[redacted]" id="contact-field.v2"></p>',
        truncated: false,
      },
    );
  });

  it('falls back to the control alone, then cuts it at the cap', () => {
    const filler = '<span>x</span>'.repeat(cap);
    expect(snippetOf(`<div>${filler}<input name="q">${filler}</div>`)).toEqual({
      html: '<input name="q">',
      truncated: false,
    });
    const attributes = Array.from({ length: cap }, (_, index) => ` data-a${index}="v"`).join('');
    const truncated = snippetOf(`<input name="q"${attributes}>`);
    expect(truncated?.truncated).toBe(true);
    expect(truncated?.html).toHaveLength(cap);
    expect(truncated?.html.startsWith('<input name="q" data-a0="[redacted]" data-a1=')).toBe(true);
  });
});
