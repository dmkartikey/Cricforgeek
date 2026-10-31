// Pitch, camera and ball-flight maths for the nets analyser (a port of vision/nets: deliveries.py, camera.py, fit.py).
// Coordinates in metres: x along the pitch from the bowler's middle stump (0) to the batter's (20.12), y across
// (positive to the bowler's right), z up. Image: u right, v down, pixels.

export const PITCH = 20.12
export const CREASE = 1.22
export const STUMP_H = 0.711
export const STUMP_W = 0.2286
export const RETURN_Y = 1.32
export const BALL_R = 0.036
export const G = 9.81
const RHO = 1.2
const AREA = Math.PI * BALL_R * BALL_R
const MASS = 0.16

export type V3 = [number, number, number]
export type Cam = { W: number; H: number; f: number; C: V3; R: number[] } // R: 3x3 row-major, world -> camera

export function project(cam: Cam, X: V3): [number, number, number] {
  const d0 = X[0] - cam.C[0], d1 = X[1] - cam.C[1], d2 = X[2] - cam.C[2]
  const R = cam.R
  const x = R[0] * d0 + R[1] * d1 + R[2] * d2
  const y = R[3] * d0 + R[4] * d1 + R[5] * d2
  const z = R[6] * d0 + R[7] * d1 + R[8] * d2
  return [cam.f * x / z + cam.W / 2, cam.f * y / z + cam.H / 2, z]
}

export function ray(cam: Cam, u: number, v: number): V3 {
  const a = (u - cam.W / 2) / cam.f, b = (v - cam.H / 2) / cam.f
  const R = cam.R
  // camera -> world is R transposed
  const d: V3 = [R[0] * a + R[3] * b + R[6], R[1] * a + R[4] * b + R[7], R[2] * a + R[5] * b + R[8]]
  const n = Math.hypot(d[0], d[1], d[2])
  return [d[0] / n, d[1] / n, d[2] / n]
}

export function lookAt(cam: V3, target: V3): number[] {
  let f = [target[0] - cam[0], target[1] - cam[1], target[2] - cam[2]]
  const fn = Math.hypot(f[0], f[1], f[2]); f = f.map(x => x / fn)
  let r = [f[1] * 1 - f[2] * 0, f[2] * 0 - f[0] * 1, 0] // fwd x up(0,0,1)
  const rn = Math.hypot(r[0], r[1], r[2]); r = r.map(x => x / rn)
  const d = [f[1] * r[2] - f[2] * r[1], f[2] * r[0] - f[0] * r[2], f[0] * r[1] - f[1] * r[0]] // fwd x right
  return [...r, ...d, ...f]
}

export function rodrigues(w: V3): number[] {
  const th = Math.hypot(w[0], w[1], w[2])
  if (th < 1e-12) return [1, 0, 0, 0, 1, 0, 0, 0, 1]
  const k = [w[0] / th, w[1] / th, w[2] / th]
  const K = [0, -k[2], k[1], k[2], 0, -k[0], -k[1], k[0], 0]
  const KK = matmul(K, K)
  const s = Math.sin(th), c = 1 - Math.cos(th)
  return [0, 1, 2, 3, 4, 5, 6, 7, 8].map(i => (i % 4 === 0 ? 1 : 0) + s * K[i] + c * KK[i])
}

export function matmul(A: number[], B: number[]): number[] {
  const o = new Array(9).fill(0)
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) o[i * 3 + j] += A[i * 3 + k] * B[k * 3 + j]
  return o
}

// ---------------------------------------------------------------- flight
// Drag, a sideways swing force and gravity; one bounce that keeps a share of the vertical (e) and along-the-ground
// (k) speed and turns the ball sideways by dev radians.
function acc(v: V3, cd: number, cs: number): V3 {
  const sp = Math.hypot(v[0], v[1], v[2])
  const kd = -0.5 * RHO * cd * AREA * sp / MASS
  const a: V3 = [kd * v[0], kd * v[1], kd * v[2]]
  const sn = Math.hypot(v[0], v[1])
  if (sn > 0) {
    const ks = 0.5 * RHO * cs * AREA * sp * sp / MASS / sn
    a[0] += ks * -v[1]; a[1] += ks * v[0]
  }
  a[2] -= G
  return a
}

export type Bounce = { t: number; p: V3; v: V3 } | null

/** Positions at the given times (seconds from the state P, V; negative times run backwards without a bounce). */
export function flight(P: V3, V: V3, times: ArrayLike<number>, cd: number, cs: number, e: number, k: number, dev: number, dt = 0.002): { pos: V3[]; bounce: Bounce } {
  const n = times.length
  const out: V3[] = new Array(n)
  const idx = Array.from({ length: n }, (_, i) => i)
  const neg = idx.filter(i => times[i] < 0).sort((a, b) => times[b] - times[a])
  let p: V3 = [...P], v: V3 = [...V], t = 0
  for (const j of neg) {
    while (t > times[j] + 1e-12) {
      const h = Math.min(dt, t - times[j])
      const a = acc(v, cd, cs)
      v = [v[0] - a[0] * h, v[1] - a[1] * h, v[2] - a[2] * h]
      p = [p[0] - v[0] * h, p[1] - v[1] * h, p[2] - v[2] * h]
      t -= h
    }
    out[j] = [...p]
  }
  p = [...P]; v = [...V]; t = 0
  let bounced = false, bounce: Bounce = null
  const pos = idx.filter(i => times[i] >= 0).sort((a, b) => times[a] - times[b])
  for (const j of pos) {
    while (t < times[j] - 1e-12) {
      const h = Math.min(dt, times[j] - t)
      const a = acc(v, cd, cs)
      const nv: V3 = [v[0] + a[0] * h, v[1] + a[1] * h, v[2] + a[2] * h]
      const np: V3 = [p[0] + 0.5 * (v[0] + nv[0]) * h, p[1] + 0.5 * (v[1] + nv[1]) * h, p[2] + 0.5 * (v[2] + nv[2]) * h]
      if (!bounced && np[2] <= BALL_R && v[2] < 0) {
        const f = (p[2] - BALL_R) / Math.max(p[2] - np[2], 1e-9)
        const pb: V3 = [p[0] + f * (np[0] - p[0]), p[1] + f * (np[1] - p[1]), BALL_R]
        const vb: V3 = [v[0] + f * (nv[0] - v[0]), v[1] + f * (nv[1] - v[1]), v[2] + f * (nv[2] - v[2])]
        bounce = { t: t + f * h, p: [...pb], v: [...vb] }
        const h0 = vb[0] * k, h1 = vb[1] * k, c = Math.cos(dev), s = Math.sin(dev)
        const va: V3 = [c * h0 - s * h1, s * h0 + c * h1, -vb[2] * e]
        const rest = h * (1 - f)
        p = [pb[0] + va[0] * rest, pb[1] + va[1] * rest, pb[2] + va[2] * rest]
        v = va
        bounced = true
      } else { p = np; v = nv }
      t += h
    }
    out[j] = [...p]
  }
  return { pos: out, bounce }
}

// ---------------------------------------------------------------- least squares
// Levenberg-Marquardt with box bounds (steps clipped to the box), a robust soft-L1 loss (big misses count less, as
// in scipy's least_squares(loss="soft_l1")), and a forward-difference Jacobian.
export type LMOpts = { lo?: number[]; hi?: number[]; fScale?: number; maxIter?: number; robust?: boolean }

export function lm(res: (p: number[]) => number[], p0: number[], o: LMOpts = {}): { x: number[]; fun: number[]; cost: number; J: number[][] } {
  const n = p0.length
  const lo = o.lo ?? new Array(n).fill(-Infinity), hi = o.hi ?? new Array(n).fill(Infinity)
  const fs = o.fScale ?? 1, robust = o.robust ?? true
  const clip = (p: number[]) => p.map((x, i) => Math.min(hi[i] - 1e-9, Math.max(lo[i] + 1e-9, x)))
  let x = clip(p0)
  const weigh = (r: number[]) => r.map(ri => robust ? 1 / Math.sqrt(Math.sqrt(1 + (ri / fs) ** 2)) : 1)
  const costOf = (r: number[]) => r.reduce((s, ri) => s + (robust ? 2 * fs * fs * (Math.sqrt(1 + (ri / fs) ** 2) - 1) : ri * ri), 0) / 2
  let r = res(x), cost = costOf(r), lam = 1e-3
  let J: number[][] = []
  const jac = (x: number[], r: number[]) => {
    const m = r.length
    const Jt: number[][] = []
    for (let j = 0; j < n; j++) {
      const h = 1e-6 * Math.max(1, Math.abs(x[j]))
      const xp = x.slice(); xp[j] = Math.min(hi[j] - 1e-9, xp[j] + h)
      let hh = xp[j] - x[j]
      if (Math.abs(hh) < 1e-14) { xp[j] = x[j] - h; hh = -h }
      const rp = res(xp)
      const col = new Array(m)
      for (let i = 0; i < m; i++) col[i] = (rp[i] - r[i]) / hh
      Jt.push(col)
    }
    return Jt // n columns of length m
  }
  const maxIter = o.maxIter ?? 100
  for (let it = 0; it < maxIter; it++) {
    J = jac(x, r)
    const w = weigh(r)
    const m = r.length
    // normal equations with sqrt-weights: (Jw^T Jw + lam diag) dx = -Jw^T rw
    const A = Array.from({ length: n }, () => new Array(n).fill(0))
    const g = new Array(n).fill(0)
    for (let a = 0; a < n; a++) {
      const ca = J[a]
      for (let b = a; b < n; b++) {
        const cb = J[b]; let s = 0
        for (let i = 0; i < m; i++) s += ca[i] * cb[i] * w[i] * w[i]
        A[a][b] = A[b][a] = s
      }
      let s = 0
      for (let i = 0; i < m; i++) s += ca[i] * r[i] * w[i] * w[i]
      g[a] = s
    }
    let improved = false
    for (let tries = 0; tries < 12; tries++) {
      const M = A.map((row, i) => row.map((val, j) => i === j ? val * (1 + lam) + 1e-12 : val))
      const dx = solve(M, g.map(v => -v))
      if (!dx) { lam *= 10; continue }
      const xn = clip(x.map((xi, i) => xi + dx[i]))
      const rn = res(xn), cn = costOf(rn)
      if (cn < cost) {
        const rel = (cost - cn) / Math.max(cost, 1e-12)
        x = xn; r = rn; cost = cn; lam = Math.max(lam / 3, 1e-9); improved = true
        if (rel < 1e-9) return { x, fun: r, cost, J }
        break
      }
      lam *= 8
    }
    if (!improved) break
  }
  return { x, fun: r, cost, J }
}

export function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length
  const M = A.map((row, i) => [...row, b[i]])
  for (let c = 0; c < n; c++) {
    let piv = c
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r
    if (Math.abs(M[piv][c]) < 1e-15) return null
    ;[M[c], M[piv]] = [M[piv], M[c]]
    for (let r = 0; r < n; r++) {
      if (r === c) continue
      const f = M[r][c] / M[c][c]
      if (f) for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]
    }
  }
  return M.map((row, i) => row[n] / row[i])
}
