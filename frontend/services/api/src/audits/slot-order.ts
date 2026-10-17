/** Integer-seeded MT19937 with rejection sampling, so stored run seeds reproduce the same slot order. */
export function shuffleAuditSlots<T>(items: T[], seedText: string): T[] {
  let seed = BigInt(seedText);
  if (seed < 0n) seed = -seed;
  const key: number[] = [];
  do {
    key.push(Number(seed & 0xffffffffn));
    seed >>= 32n;
  } while (seed);
  const state = new Uint32Array(624);
  state[0] = 19650218;
  for (let i = 1; i < state.length; i++)
    state[i] = (Math.imul(1812433253, state[i - 1]! ^ (state[i - 1]! >>> 30)) + i) >>> 0;
  let i = 1,
    j = 0;
  for (let remaining = Math.max(state.length, key.length); remaining; remaining--) {
    state[i] =
      ((state[i]! ^ Math.imul(state[i - 1]! ^ (state[i - 1]! >>> 30), 1664525)) + key[j]! + j) >>>
      0;
    i++;
    j++;
    if (i >= state.length) {
      state.copyWithin(0, 623, 624);
      i = 1;
    }
    if (j >= key.length) j = 0;
  }
  for (let remaining = state.length - 1; remaining; remaining--) {
    state[i] =
      ((state[i]! ^ Math.imul(state[i - 1]! ^ (state[i - 1]! >>> 30), 1566083941)) - i) >>> 0;
    i++;
    if (i >= state.length) {
      state.copyWithin(0, 623, 624);
      i = 1;
    }
  }
  state[0] = 0x80000000;
  let index = state.length;
  const next = () => {
    if (index >= state.length) {
      for (let n = 0; n < state.length; n++) {
        const value = (state[n]! & 0x80000000) | (state[(n + 1) % state.length]! & 0x7fffffff);
        state[n] = state[(n + 397) % state.length]! ^ (value >>> 1) ^ (value & 1 ? 0x9908b0df : 0);
      }
      index = 0;
    }
    let value = state[index++]!;
    value ^= value >>> 11;
    value ^= (value << 7) & 0x9d2c5680;
    value ^= (value << 15) & 0xefc60000;
    value ^= value >>> 18;
    return value >>> 0;
  };
  for (let end = items.length - 1; end > 0; end--) {
    const size = end + 1,
      bits = Math.floor(Math.log2(size)) + 1;
    let selected: number;
    do {
      selected = next() >>> (32 - bits);
    } while (selected >= size);
    [items[end], items[selected]] = [items[selected]!, items[end]!];
  }
  return items;
}
