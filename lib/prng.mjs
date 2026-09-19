// Deterministic pseudo-random number generation.
//
// Every puzzle in the corpus must be reproducible from (generator_version,
// seed, params), so nothing here may touch Math.random or the clock. The seed
// is a string; it is hashed to 32 bits and then run through splitmix32.

export function seedToUint32(seed) {
  const s = String(seed);
  // FNV-1a, 32 bit.
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function makeRng(seed) {
  let a = seedToUint32(seed);
  // splitmix32
  const next = () => {
    a = (a + 0x9e3779b9) >>> 0;
    let z = a;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
    return (z ^ (z >>> 15)) >>> 0;
  };
  const rng = {
    uint32: next,
    // Uniform in [0, n) without modulo bias.
    int(n) {
      if (n <= 0) throw new RangeError('rng.int needs n > 0');
      const limit = Math.floor(0x100000000 / n) * n;
      let v;
      do { v = next(); } while (v >= limit);
      return v % n;
    },
    float() { return next() / 0x100000000; },
    pick(arr) { return arr[rng.int(arr.length)]; },
    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = rng.int(i + 1);
        const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
      }
      return arr;
    },
  };
  return rng;
}
