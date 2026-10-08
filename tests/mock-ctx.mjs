// Aufzeichnender Canvas Kontext für Tests ohne Browser. Jede Methode ist erlaubt und wird gezählt.
export function createMockCtx() {
  const calls = [];
  const gradient = () => ({ addColorStop() {} });
  const base = {
    calls,
    measureText: (t) => ({ width: String(t).length * 8 }),
    createLinearGradient: gradient,
    createRadialGradient: gradient,
    createConicGradient: gradient,
    createPattern: () => ({}),
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
  };
  const state = {};
  return new Proxy(base, {
    get(t, k) {
      if (k in t) return t[k];
      if (k in state) return state[k];
      return (...args) => { calls.push([k, ...args]); };
    },
    set(t, k, v) { state[k] = v; return true; },
  });
}
