// From pixels to a delivery: calibrate the phone from taps on the stumps and creases, then fit each ball's flight
// with physics. A port of vision/nets/fit.py (the reference, tested on thousands of simulated deliveries).
import { Cam, V3, PITCH, CREASE, BALL_R, G, project, ray, lookAt, rodrigues, matmul, flight, lm } from './geom'

export type Tap = { u: number; v: number; X: V3 }
export type Obs = { t: number; u: number; v: number; r?: number | null }
export type Result = {
  speedKmh: number; rmsPx: number; nObs: number; cd: number; cs: number; e: number; k: number; devDeg: number
  bounceX?: number; bounceY?: number; lengthM?: number; speedBounceKmh?: number; swingM?: number
  lineY?: number; heightZ?: number; speedSd?: number; lengthSd?: number
  path?: V3[] // the fitted flight, release to the batter's end, for drawing
}

const LO = [-10, -5, 0, 5, -15, -15, 0.3, -0.4, 0.2, 0.6, -0.4]
const HI = [25, 5, 4, 70, 15, 15, 0.6, 0.4, 0.95, 1.0, 0.4]
const deg = (r: number) => r * 180 / Math.PI
const rad = (d: number) => d * Math.PI / 180

// ---------------------------------------------------------------- calibration
function rollDeg(R: number[]) { return deg(Math.atan2(R[2], Math.hypot(R[0], R[1]))) }

export function calibrate(taps: Tap[], W: number, H: number, hfovDeg?: number, sigFIn?: number): { cam: Cam; rms: number } {
  const fovC = hfovDeg ?? 62
  const fC = (W / 2) / Math.tan(rad(fovC) / 2)
  const sigF = sigFIn ?? (hfovDeg ? 0.08 : 0.6)
  let best: { cost: number; cam: Cam; fun: number[] } | null = null
  for (const cx of [-2.0, -3.5, -5.5, -8.0]) for (const fov of hfovDeg ? [fovC] : [34, 50, 68]) for (const cy of [-0.6, 0.6]) {
    const C0: V3 = [cx, cy, 1.5]
    const R0 = lookAt(C0, [PITCH, 0, 0.4])
    const f0 = (W / 2) / Math.tan(rad(fov) / 2)
    const mk = (p: number[]): Cam => ({ W, H, f: Math.exp(p[6]) * f0, C: [p[0], p[1], p[2]], R: matmul(rodrigues([p[3], p[4], p[5]]), R0) })
    const res = (p: number[]) => {
      const cam = mk(p)
      const r: number[] = []
      for (const t of taps) {
        const [u, v, z] = project(cam, t.X)
        if (z > 0) r.push(u - t.u, v - t.v); else r.push(1e3, 1e3)
      }
      r.push(Math.log(cam.f / fC) / sigF, rollDeg(cam.R) / 4, (p[2] - 1.5) / 0.8, (p[0] + 4) / 6)
      return r
    }
    const sol = lm(res, [...C0, 0, 0, 0, 0], { fScale: 3, maxIter: 150 })
    if (!best || sol.cost < best.cost) best = { cost: sol.cost, cam: mk(sol.x), fun: sol.fun }
  }
  const f = best!.fun.slice(0, -4)
  return { cam: best!.cam, rms: Math.sqrt(f.reduce((s, x) => s + x * x, 0) / Math.max(f.length, 1)) }
}

// ---------------------------------------------------------------- one ball
type Prep = { tt: number[]; u: number[]; v: number[]; r: (number | null)[]; t0: number; p0: number[][]; n: number }

function groundHit(cam: Cam, u: number, v: number, z = BALL_R): V3 | null {
  const d = ray(cam, u, v)
  if (d[2] >= -1e-6) return null
  const t = (z - cam.C[2]) / d[2]
  return [cam.C[0] + t * d[0], cam.C[1] + t * d[1], cam.C[2] + t * d[2]]
}
function planeX(cam: Cam, u: number, v: number, x: number): V3 | null {
  const d = ray(cam, u, v)
  if (Math.abs(d[0]) < 1e-6) return null
  const t = (x - cam.C[0]) / d[0]
  return t > 0 ? [cam.C[0] + t * d[0], cam.C[1] + t * d[1], cam.C[2] + t * d[2]] : null
}
const clip = (p: number[]) => p.map((x, i) => Math.min(HI[i] - 1e-6, Math.max(LO[i] + 1e-6, x)))
const linspace = (a: number, b: number, n: number) => Array.from({ length: n }, (_, i) => a + (b - a) * i / (n - 1))

function initial(cam: Cam, tt: number[], u: number[], v: number[], keep = 3): number[][] | null {
  const n = v.length
  const vs = n > 4 ? v.map((_, i) => (v[Math.max(i - 1, 0)] * (i > 0 ? 1 : 0) + v[i] + (i < n - 1 ? v[i + 1] : 0)) / 3) : v
  let ib = n - 1
  if (n > 4) { ib = 1; for (let i = 1; i < n - 1; i++) if (vs[i] > vs[ib]) ib = i }
  const anchors: [V3, number][] = []
  if (ib >= 1 && ib < n - 2 && v[ib] > v[0] + 3) {
    for (const j of new Set([Math.max(1, ib - 1), ib, Math.min(n - 2, ib + 1)])) {
      const pb = groundHit(cam, u[j], v[j]); if (pb) anchors.push([pb, tt[j]])
    }
  }
  for (const x of [PITCH - 1, PITCH]) {
    const pb = planeX(cam, u[n - 1], v[n - 1], x)
    if (pb && pb[2] > 0 && pb[2] < 2.5) anchors.push([pb, tt[n - 1]])
  }
  const d0 = ray(cam, u[0], v[0]), d1 = ray(cam, u[n - 1], v[n - 1])
  for (const lam of linspace(3, 30, 19)) {
    const pb: V3 = [cam.C[0] + lam * d1[0], cam.C[1] + lam * d1[1], cam.C[2] + lam * d1[2]]
    if (pb[2] > 0 && pb[2] < 3.2 && pb[0] > -2 && pb[0] < PITCH + 3) anchors.push([pb, tt[n - 1]])
  }
  const cands: [number, V3, V3][] = []
  for (const [pb, tb] of anchors) {
    if (tb <= 0) continue
    for (const lam of linspace(1, 16, 31)) {
      const P0: V3 = [cam.C[0] + lam * d0[0], cam.C[1] + lam * d0[1], cam.C[2] + lam * d0[2]]
      if (P0[2] < 0.3 || P0[2] > 3.2) continue
      const V0: V3 = [(pb[0] - P0[0]) / tb, (pb[1] - P0[1]) / tb, (pb[2] - P0[2] + 0.5 * G * tb * tb) / tb]
      if (V0[0] < 5 || V0[0] > 60) continue
      const { pos } = flight(P0, V0, tt, 0.45, 0, 0.58, 0.88, 0, 0.004)
      let err = 0, ok = true
      for (let i = 0; i < n; i++) {
        const [pu, pv, z] = project(cam, pos[i]); if (z <= 0) { ok = false; break }
        err += Math.abs(pu - u[i]) + Math.abs(pv - v[i])
      }
      if (ok) cands.push([err / (2 * n), P0, V0])
    }
  }
  cands.sort((a, b) => a[0] - b[0])
  const out: number[][] = []
  for (const [, P0, V0] of cands) {
    if (out.every(q => Math.hypot(P0[0] - q[0], P0[1] - q[1], P0[2] - q[2]) > 0.5)) out.push(clip([...P0, ...V0, 0.45, 0, 0.58, 0.88, 0]))
    if (out.length >= keep) break
  }
  return out.length ? out : null
}

function prep(cam: Cam, obsIn: Obs[], readout: number): Prep | null {
  const obs = [...obsIn].sort((a, b) => a.t - b.t)
  if (obs.length < 5) return null
  const t = obs.map(o => o.t + readout * o.v / cam.H) // rolling shutter: the row's own capture time
  const tt = t.map(x => x - t[0])
  const u = obs.map(o => o.u), v = obs.map(o => o.v)
  const p0 = initial(cam, tt, u, v)
  if (!p0) return null
  return { tt, u, v, r: obs.map(o => o.r ?? null), t0: t[0], p0, n: obs.length }
}

function ballRes(cam: Cam, d: Prep, p: number[]): number[] {
  const { pos } = flight([p[0], p[1], p[2]], [p[3], p[4], p[5]], d.tt, p[6], p[7], p[8], p[9], p[10])
  const r: number[] = [], rr: number[] = []
  for (let i = 0; i < d.n; i++) {
    const [pu, pv, z] = project(cam, pos[i])
    r.push(pu - d.u[i], pv - d.v[i])
    const ro = d.r[i]
    rr.push(ro ? (BALL_R * cam.f / Math.max(z, 0.3) - ro) / (0.15 * ro + 0.4) : 0)
  }
  return [...r, ...rr, (p[6] - 0.45) / 0.05, p[7] / 0.2, (p[8] - 0.58) / 0.12, (p[9] - 0.88) / 0.06, p[10] / rad(6)]
}

type Sol = { x: number[]; fun: number[]; cost: number; J: number[][] }
function fitBall(cam: Cam, d: Prep, starts?: number[][]): Sol {
  let best: Sol | null = null
  for (const p0 of starts ?? d.p0) {
    const s = lm(p => ballRes(cam, d, p), p0, { lo: LO, hi: HI, fScale: 1.5, maxIter: 60 })
    if (!best || s.cost < best.cost) best = s
  }
  return best!
}

const posRms = (s: Sol, n: number) => { let a = 0; for (let i = 0; i < 2 * n; i++) a += s.fun[i] ** 2; return Math.sqrt(a / (2 * n)) }

function trimmed(cam: Cam, obsIn: Obs[], readout: number): { d: Prep; sol: Sol; obs: Obs[] } | null {
  let obs = [...obsIn].sort((a, b) => a.t - b.t)
  let d = prep(cam, obs, readout)
  if (!d) return null
  let sol = fitBall(cam, d)
  // drop the sightings the flight can't explain (the ball still in the hand, a wrong pick) and fit again
  for (let round = 0; round < 2; round++) {
    const res = Array.from({ length: d.n }, (_, i) => Math.hypot(sol.fun[2 * i], sol.fun[2 * i + 1]))
    const med = [...res].sort((a, b) => a - b)[Math.floor(res.length / 2)]
    const keep = res.map(x => x < Math.max(3, 4 * 1.4826 * med))
    const nk = keep.filter(Boolean).length
    if (nk === keep.length || nk < 6) break
    obs = obs.filter((_, i) => keep[i])
    const d2 = prep(cam, obs, readout)
    if (!d2) break
    d2.p0 = [sol.x, ...d2.p0]
    d = d2; sol = fitBall(cam, d2)
  }
  // the first sightings pull hardest on the release speed: test each by prediction from the others
  for (let i = 0; i < 3 && d.n >= 8; i++) {
    const o2 = obs.slice(1)
    const d2 = prep(cam, o2, readout)
    if (!d2) break
    const s2 = fitBall(cam, d2)
    const tFirst = obs[0].t + readout * obs[0].v / cam.H - d2.t0
    const p = s2.x
    const { pos } = flight([p[0], p[1], p[2]], [p[3], p[4], p[5]], [tFirst], p[6], p[7], p[8], p[9], p[10])
    const [pu, pv] = project(cam, pos[0])
    if (Math.hypot(pu - obs[0].u, pv - obs[0].v) > Math.max(3.5, 4 * posRms(s2, d2.n))) { d = d2; sol = s2; obs = o2 } else break
  }
  return { d, sol, obs }
}

export function results(p: number[], rms: number, n: number, withPath = false): Result {
  const ts = linspace(-0.6, 1.4, 1001)
  const { pos, bounce } = flight([p[0], p[1], p[2]], [p[3], p[4], p[5]], ts, p[6], p[7], p[8], p[9], p[10])
  const vel = pos.map((_, i) => {
    const a = Math.max(i - 1, 0), b = Math.min(i + 1, pos.length - 1)
    return [0, 1, 2].map(k => (pos[b][k] - pos[a][k]) / (ts[b] - ts[a])) as V3
  })
  let ic = 0
  for (let i = 0; i < pos.length; i++) if (Math.abs(pos[i][0] - CREASE) < Math.abs(pos[ic][0] - CREASE)) ic = i
  const out: Result = { speedKmh: Math.hypot(...vel[ic]) * 3.6, rmsPx: rms, nObs: n, cd: p[6], cs: p[7], e: p[8], k: p[9], devDeg: deg(p[10]) }
  if (bounce && bounce.p[0] < PITCH + 0.5) {
    const pb = bounce.p
    out.bounceX = pb[0]; out.bounceY = pb[1]; out.lengthM = PITCH - pb[0]
    out.speedBounceKmh = Math.hypot(...bounce.v) * 3.6
    const pc = pos[ic], vc = vel[ic]
    out.swingM = pb[1] - (pc[1] + vc[1] / vc[0] * (pb[0] - pc[0]))
  }
  const js = pos.findIndex(q => q[0] >= PITCH)
  if (js > 0) { out.lineY = pos[js][1]; out.heightZ = pos[js][2] }
  if (withPath) {
    const end = js > 0 ? Math.min(js + 40, pos.length) : pos.length
    out.path = pos.slice(0, end).filter((_, i) => i >= ic - 5 && i % 4 === 0)
  }
  return out
}

/** 1-sigma spread of speed and length from the fit's curvature (how tightly the pixels pin them down). */
function spread(sol: Sol, detPx = 1.0): { speedSd?: number; lengthSd?: number } {
  const n = sol.x.length
  const JtJ = Array.from({ length: n }, (_, a) => Array.from({ length: n }, (_, b) => sol.J[a].reduce((s, x, i) => s + x * sol.J[b][i], 0)))
  // invert by solving for each unit vector
  const inv: number[][] = []
  for (let j = 0; j < n; j++) {
    const e = new Array(n).fill(0); e[j] = 1
    const M = JtJ.map((row, i) => row.map((v, k) => v + (i === k ? 1e-9 : 0)))
    const col = solveSym(M, e); if (!col) return {}
    inv.push(col)
  }
  const base = results(sol.x, 0, 0)
  const gs: number[] = [], gl: number[] = []
  for (let j = 0; j < n; j++) {
    const h = 1e-4 * Math.max(1, Math.abs(sol.x[j]))
    const q = sol.x.slice(); q[j] += h
    const rj = results(q, 0, 0)
    gs.push((rj.speedKmh - base.speedKmh) / h)
    gl.push(base.lengthM !== undefined && rj.lengthM !== undefined ? (rj.lengthM - base.lengthM) / h : 0)
  }
  const quad = (g: number[]) => { let s = 0; for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) s += g[a] * inv[a][b] * g[b]; return Math.sqrt(Math.max(s, 0)) * detPx }
  return { speedSd: quad(gs), lengthSd: base.lengthM !== undefined ? quad(gl) : undefined }
}
function solveSym(A: number[][], b: number[]) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]])
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r
    if (Math.abs(M[p][c]) < 1e-18) return null
    ;[M[c], M[p]] = [M[p], M[c]]
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; if (f) for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k] }
  }
  return M.map((r, i) => r[n] / r[i])
}

export function fitDelivery(cam: Cam, obs: Obs[], readout = 0): Result | null {
  const t = trimmed(cam, obs, readout)
  if (!t) return null
  const out = results(t.sol.x, posRms(t.sol, t.d.n), t.d.n, true)
  Object.assign(out, spread(t.sol))
  return out
}

// ---------------------------------------------------------------- a whole session
/** Calibrate from the taps, then refine the camera with every delivery: gravity and the frame clock give each
 *  flight an absolute scale, so together the flights pin down the camera far better than taps on distant stumps.
 *  Alternates camera-only and ball-only fits (cheaper than one joint fit, and converges to the same place). */
export function fitSession(taps: Tap[], balls: Obs[][], W: number, H: number, readout: number, hfovDeg?: number,
  onProgress?: (done: number, total: number) => void, sigFIn?: number): { cam: Cam; results: (Result | null)[]; calibRms: number } {
  const { cam: cam0, rms } = calibrate(taps, W, H, hfovDeg, sigFIn)
  const total = balls.length * 3
  let done = 0
  const tri = balls.map(o => { const r = trimmed(cam0, o, readout); onProgress?.(++done, total); return r })
  const idx = tri.map((t, i) => t ? i : -1).filter(i => i >= 0)
  if (!idx.length) return { cam: cam0, results: balls.map(() => null), calibRms: rms }
  let ps = idx.map(i => tri[i]!.sol.x)
  const preps = idx.map(i => tri[i]!.d)
  const fC = (W / 2) / Math.tan(rad(hfovDeg ?? 62) / 2), sigF = sigFIn ?? (hfovDeg ? 0.08 : 0.6)
  const camOf = (q: number[]): Cam => ({ W, H, f: cam0.f * Math.exp(q[6]), C: [cam0.C[0] + q[0], cam0.C[1] + q[1], cam0.C[2] + q[2]], R: matmul(rodrigues([q[3], q[4], q[5]]), cam0.R) })
  let q = [0, 0, 0, 0, 0, 0, 0]
  const tapPx = 2.0, detPx = 1.0
  for (let round = 0; round < 3; round++) {
    const resCam = (qq: number[]) => {
      const cam = camOf(qq)
      const r: number[] = []
      for (const t of taps) { const [u, v] = project(cam, t.X); r.push((u - t.u) / tapPx, (v - t.v) / tapPx) }
      r.push(Math.log(cam.f / fC) / sigF, rollDeg(cam.R) / 4)
      preps.forEach((d, j) => { const b = ballRes(cam, d, ps[j]); for (let i = 0; i < 2 * d.n; i++) r.push(b[i] / detPx); for (let i = 2 * d.n; i < b.length; i++) r.push(b[i]) })
      return r
    }
    q = lm(resCam, q, { lo: [-8, -4, -2, -0.5, -0.5, -0.5, -1.5], hi: [8, 4, 2, 0.5, 0.5, 0.5, 1.5], fScale: 2, maxIter: 20 }).x
    const cam = camOf(q)
    ps = preps.map((d, j) => { const s = fitBall(cam, d, [ps[j]]); onProgress?.(Math.min(++done, total), total); return s.x })
  }
  const cam = camOf(q)
  const outRes: (Result | null)[] = balls.map(() => null)
  idx.forEach((i, j) => { const d = preps[j]; outRes[i] = results_(fitBall(cam, d, [ps[j]]), d) })
  return { cam, results: outRes, calibRms: rms }
  function results_(s: Sol, d: Prep) { const r = results(s.x, posRms(s, d.n), d.n, true); Object.assign(r, spread(s)); return r }
}
