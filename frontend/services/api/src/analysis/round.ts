/** Round the represented binary value to `digits` decimals, with ties to even. */
export function round(value: number, digits: number) {
  if (!Number.isFinite(value) || !Number.isInteger(digits) || digits < 0 || digits > 15)
    throw new Error('Invalid metric rounding');
  if (value === 0) return value;
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, Math.abs(value));
  const bits = view.getBigUint64(0),
    exponent = Number((bits >> 52n) & 0x7ffn);
  const fraction = bits & ((1n << 52n) - 1n);
  const significand = exponent ? fraction | (1n << 52n) : fraction;
  const power = (exponent || 1) - 1023 - 52;
  let numerator = significand * 10n ** BigInt(digits),
    denominator = 1n;
  if (power >= 0) numerator <<= BigInt(power);
  else denominator <<= BigInt(-power);
  let quotient = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder * 2n > denominator || (remainder * 2n === denominator && quotient % 2n !== 0n))
    quotient++;
  return (Math.sign(value) * Number(quotient)) / 10 ** digits;
}
