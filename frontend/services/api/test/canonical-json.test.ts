import { describe, expect, it } from 'vitest';

import { canonicalHash, canonicalJson } from '../src/canonical-json.ts';

/** The six-character `\uXXXX` escape text for one UTF-16 code unit. */
const u = (hex: string) => `${'\\'}u${hex}`;

describe('canonical JSON', () => {
  // Bytes and hashes recorded from the encoder before it refused non-JSON
  // values: identity hashes persisted from these shapes must never move.
  it.each([
    [
      {
        target_kind: 'url',
        url: 'https://example.com/pricing',
        market: { country: 'US', language: 'en' },
        override_id: null,
      },
      true,
      '{"market":{"country":"US","language":"en"},"override_id":null,"target_kind":"url","url":"https://example.com/pricing"}',
      'a0516083068674d57d89d13a3fb7f5a568672cfe7a581319e98feadcc00d7fec',
    ],
    [
      {
        window: '2026-10-01/2026-10-28',
        grain: 'week',
        sources: ['gsc', 'ga4'],
        keyword: 'café crème',
      },
      true,
      `{"grain":"week","keyword":"caf${u('00e9')} cr${u('00e8')}me","sources":["gsc","ga4"],"window":"2026-10-01/2026-10-28"}`,
      'e0c37294f4602762fbdffb4f87b897b00c2ea0dc1bdfda85a139dc08da60ea5c',
    ],
    [
      { keyword: 'café crème', emoji: 'rocket 🚀', zh: '中文' },
      false,
      '{"emoji":"rocket 🚀","keyword":"café crème","zh":"中文"}',
      '11e4341733ae29c8b14d22062c7e4fb433774660ebbfb2bdfb7ea2e1b932dace',
    ],
    [
      { b: 1, a: [3, -0, 0.1, 1e21, -2.5, Number.NaN, Infinity], B: true, é: false, _: null },
      true,
      `{"B":true,"_":null,"a":[3,0,0.1,1e+21,-2.5,null,null],"b":1,"${u('00e9')}":false}`,
      'e199d2633d42e325adff230d36cd26af499eb0f18cf98928b19ec8492b06d352',
    ],
    [
      [[], {}, '', 'quote " back \\ newline \n tab \t', [null, [1, [2]]]],
      true,
      '[[],{},"","quote \\" back \\\\ newline \\n tab \\t",[null,[1,[2]]]]',
      'ad29f2037634aae5851ae6edadfd750e903cb22a4b967ad18dc2629352312bf1',
    ],
    [
      `\x00\x1f\x7f\x80\xff${String.fromCharCode(0xffff)} 🚀`,
      true,
      `"${u('0000')}${u('001f')}\x7f${u('0080')}${u('00ff')}${u('ffff')} ${u('d83d')}${u('de80')}"`,
      '869a62d6b038604b91154b953bf4dc1b18f52bb2a582064f9189b1b305f02e56',
    ],
    [
      { nested: { z: { y: { x: 'deep' } }, a: [{ k: 2, j: 1 }] } },
      false,
      '{"nested":{"a":[{"j":1,"k":2}],"z":{"y":{"x":"deep"}}}}',
      '58893a4abab32313e286802b5f172004792adfc4c20d83cfb93377bf3e3087c0',
    ],
    [42, true, '42', '73475cb40a568e8da8a045ced110137e159f890ac4da883b6b17dc651b3a8049'],
    [null, true, 'null', '74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b'],
    [true, false, 'true', 'b5bea41b6c623f7c09f1bf24dcae58ebab3c0cdd90ad966bc43a45b44867e12b'],
    ['plain', false, '"plain"', '945603a8f587786b463c3f94fce115c0fae88fac2728cc96ddf5981cf7f61741'],
  ])('keeps the bytes of %j (ascii %s)', (value, ascii, json, hash) => {
    expect(canonicalJson(value, ascii)).toBe(json);
    expect(canonicalHash(value, ascii)).toBe(hash);
  });

  it('encodes a null-prototype record like an object literal', () => {
    const record = Object.assign(Object.create(null) as Record<string, unknown>, { b: 2, a: 1 });
    expect(canonicalJson(record)).toBe('{"a":1,"b":2}');
  });

  it.each([
    ['undefined', undefined],
    ['an undefined field', { a: undefined }],
    ['an undefined item', [1, undefined]],
    ['a function', { a: () => 1 }],
    ['a symbol', Symbol('s')],
    ['a bigint', 1n],
    ['a Date', { at: new Date('2026-11-13T00:00:00Z') }],
    ['a Map', new Map([['a', 1]])],
    ['a Set', [new Set([1])]],
  ])('refuses %s in either mode', (_label, value) => {
    expect(() => canonicalJson(value)).toThrow(TypeError);
    expect(() => canonicalJson(value, false)).toThrow(TypeError);
  });
});
