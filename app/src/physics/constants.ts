/** Physical constants and small numeric helpers (SI units throughout). */

export const MU0 = 4e-7 * Math.PI; // 진공 투자율 [H/m]
export const CELSIUS_AMBIENT = 25; // 기본 주위 온도 [°C]

export const clamp = (x: number, lo: number, hi: number) =>
  x < lo ? lo : x > hi ? hi : x;

/** Solve `f(x) = target` for a monotonically increasing `f` on `[lo, hi]`. */
export function bisect(
  f: (x: number) => number,
  target: number,
  lo: number,
  hi: number,
  iterations = 80,
): number {
  let a = lo;
  let b = hi;
  for (let i = 0; i < iterations; i++) {
    const mid = (a + b) / 2;
    if (f(mid) < target) a = mid;
    else b = mid;
  }
  return (a + b) / 2;
}
