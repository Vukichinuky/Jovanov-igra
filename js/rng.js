/* Seeded RNG so playtests are reproducible when a seed is set. */
const RNG = (() => {
  let state = 0x9e3779b9;

  function seed(s) {
    if (s == null || s === "") {
      state = (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
    } else if (typeof s === "number") {
      state = (s >>> 0) || 1;
    } else {
      // hash string
      let h = 2166136261 >>> 0;
      const str = String(s);
      for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
      }
      state = h || 1;
    }
  }

  // Mulberry32
  function next() {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function int(n)        { return Math.floor(next() * n); }
  function range(lo, hi) { return lo + int(hi - lo + 1); }
  function pick(arr)     { return arr[int(arr.length)]; }
  function chance(p)     { return next() < p; }
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = int(i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  return { seed, next, int, range, pick, chance, shuffle };
})();
