// Finding the ball in video frames: motion candidates, the small ball network, and the tracker.
// A port of vision/nets/detect.py, track.py and the track extension in e2e.py.
// Frames are Float32Array, interleaved B, G, R (the channel order the network was trained on), 0..255.

export type Frame = { w: number; h: number; d: Float32Array }
export type Det = [number, number, number, number] // u, v, p (ball probability), r (radius px)

export const PATCH = 32
export const gapFor = (fps: number, seconds = 0.1) => Math.max(1, Math.round(fps * seconds))

// ---------------------------------------------------------------- motion map
// Per-frame work (a 2x2 blur and the 3x3 max/min of that) is done once per frame and cached by the caller through
// prepFrame; the motion map then only compares cached arrays.
export type Prepped = { w: number; h: number; c: Float32Array; mx: Float32Array; mn: Float32Array }

export function prepFrame(f: Frame): Prepped {
  const { w, h, d } = f, n = d.length, row = w * 3
  const c = new Float32Array(n)
  // 2x2 mean over (x-1..x, y-1..y); the first row/column reuse their neighbour (as a reflected edge)
  for (let y = 0; y < h; y++) {
    const r0 = y * row, r1 = (y > 0 ? y - 1 : 1) * row
    for (let i = 0; i < row; i++) {
      const j = i >= 3 ? i - 3 : i + 3
      c[r0 + i] = 0.25 * (d[r0 + i] + d[r0 + j] + d[r1 + i] + d[r1 + j])
    }
  }
  const hx = new Float32Array(n), hn = new Float32Array(n)
  for (let y = 0; y < h; y++) {
    const r = y * row
    for (let i = 0; i < row; i++) {
      const a = c[r + (i >= 3 ? i - 3 : i)], b = c[r + i], e = c[r + (i + 3 < row ? i + 3 : i)]
      hx[r + i] = a > b ? (a > e ? a : e) : (b > e ? b : e)
      hn[r + i] = a < b ? (a < e ? a : e) : (b < e ? b : e)
    }
  }
  const mx = new Float32Array(n), mn = new Float32Array(n)
  for (let y = 0; y < h; y++) {
    const r = y * row, ru = (y > 0 ? y - 1 : y) * row, rd = (y < h - 1 ? y + 1 : y) * row
    for (let i = 0; i < row; i++) {
      const a = hx[ru + i], b = hx[r + i], e = hx[rd + i]
      mx[r + i] = a > b ? (a > e ? a : e) : (b > e ? b : e)
      const p = hn[ru + i], q = hn[r + i], t = hn[rd + i]
      mn[r + i] = p < q ? (p < t ? p : t) : (q < t ? q : t)
    }
  }
  return { w, h, c, mx, mn }
}

/** How far each pixel of `cur` lies outside the 3x3 range of the other frame (ignores sub-pixel shake), max over
 *  colour channels, then the smaller of the comparisons with the frame before and the frame after. */
export function motionMapP(p: Prepped, c: Prepped, n: Prepped): Float32Array {
  const N = c.w * c.h, m = new Float32Array(N), cc = c.c
  for (let i = 0, j = 0; i < N; i++, j += 3) {
    let dp = 0, dn = 0
    for (let k = j; k < j + 3; k++) {
      const v = cc[k]
      let a = v - p.mx[k]; if (a > dp) dp = a
      a = p.mn[k] - v; if (a > dp) dp = a
      a = v - n.mx[k]; if (a > dn) dn = a
      a = n.mn[k] - v; if (a > dn) dn = a
    }
    m[i] = dp < dn ? dp : dn
  }
  return m
}

export function motionMap(prev: Frame, cur: Frame, nxt: Frame): Float32Array {
  return motionMapP(prepFrame(prev), prepFrame(cur), prepFrame(nxt))
}

function boxMean(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length), k = 2 * r + 1
  for (let y = 0; y < h; y++) {
    const o = y * w
    for (let x = 0; x < w; x++) {
      let s = 0
      for (let d = -r; d <= r; d++) { const q = x + d; s += src[o + (q < 0 ? 0 : q >= w ? w - 1 : q)] }
      tmp[o + x] = s / k
    }
  }
  for (let y = 0; y < h; y++) {
    for (let d = -r; d <= r; d++) {
      const q = y + d, src2 = (q < 0 ? 0 : q >= h ? h - 1 : q) * w, o = y * w
      for (let x = 0; x < w; x++) out[o + x] += tmp[src2 + x]
    }
    const o = y * w
    for (let x = 0; x < w; x++) out[o + x] /= k
  }
  return out
}

function maxFilter(src: Float32Array, w: number, h: number, r: number): Float32Array {
  // a peak test only needs the max of the window; done as two 1-D passes
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length)
  for (let y = 0; y < h; y++) {
    const o = y * w
    for (let x = 0; x < w; x++) {
      let m = -Infinity; const a = x - r < 0 ? 0 : x - r, b = x + r >= w ? w - 1 : x + r
      for (let q = a; q <= b; q++) { const v = src[o + q]; if (v > m) m = v }
      tmp[o + x] = m
    }
  }
  out.fill(-Infinity)
  for (let y = 0; y < h; y++) {
    const a = y - r < 0 ? 0 : y - r, b = y + r >= h ? h - 1 : y + r, o = y * w
    for (let q = a; q <= b; q++) { const s2 = q * w; for (let x = 0; x < w; x++) { const v = tmp[s2 + x]; if (v > out[o + x]) out[o + x] = v } }
  }
  return out
}

/** The strongest local peaks of motion: deliberately permissive; the network and tracker throw out the rest. */
export function candidates(prev: Frame, cur: Frame, nxt: Frame, maxN = 60, minSep = 6, pp?: [Prepped, Prepped, Prepped]): [number, number, number][] {
  const { w, h } = cur
  const m = pp ? motionMapP(pp[0], pp[1], pp[2]) : motionMap(prev, cur, nxt)
  // noise: robust spread of the plain frame difference (every 4th pixel)
  const diffs: number[] = []
  for (let y = 0; y < h; y += 4) for (let x = 0; x < w; x += 4) {
    const i = (y * w + x) * 3
    diffs.push(Math.max(Math.abs(cur.d[i] - prev.d[i]), Math.abs(cur.d[i + 1] - prev.d[i + 1]), Math.abs(cur.d[i + 2] - prev.d[i + 2])))
  }
  diffs.sort((a, b) => a - b)
  const noise = 1.4826 * diffs[diffs.length >> 1] + 1
  const ms = boxMean(m, w, h, 1)
  const mx = maxFilter(ms, w, h, minSep)
  const peaks: [number, number, number][] = []
  for (let i = 0; i < w * h; i++) if (ms[i] >= mx[i] && ms[i] > 0.8 * noise) peaks.push([i % w, (i / w) | 0, ms[i]])
  peaks.sort((a, b) => b[2] - a[2])
  return peaks.slice(0, maxN).map(([u, v, s]) => {
    let tot = 0, su = 0, sv = 0
    for (let y = Math.max(v - 2, 0); y < Math.min(v + 3, h); y++) for (let x = Math.max(u - 2, 0); x < Math.min(u + 3, w); x++) {
      const wgt = m[y * w + x]; tot += wgt; su += wgt * x; sv += wgt * y
    }
    tot = tot || 1
    return [su / tot + 0.5, sv / tot + 0.5, s]
  })
}

/** 5 x 32 x 32 network input centred on (u, v): the frame in colour (centred) and its differences with the frames
 *  before and after. Returns the input and the patch centre. */
export function patch(prev: Frame, cur: Frame, nxt: Frame, u: number, v: number): [Float32Array, number, number] {
  const S = PATCH, half = S / 2, { w, h } = cur
  const x0 = Math.round(u) - half, y0 = Math.round(v) - half
  const out = new Float32Array(5 * S * S)
  const cc = new Float32Array(S * S * 3)
  let mu0 = 0, mu1 = 0, mu2 = 0
  for (let yy = 0; yy < S; yy++) for (let xx = 0; xx < S; xx++) {
    const x = x0 + xx, y = y0 + yy, o = (yy * S + xx) * 3
    if (x < 0 || y < 0 || x >= w || y >= h) continue
    const i = (y * w + x) * 3
    cc[o] = cur.d[i]; cc[o + 1] = cur.d[i + 1]; cc[o + 2] = cur.d[i + 2]
    let dp = 0, dn = 0
    for (let k = 0; k < 3; k++) { dp = Math.max(dp, Math.abs(cur.d[i + k] - prev.d[i + k])); dn = Math.max(dn, Math.abs(cur.d[i + k] - nxt.d[i + k])) }
    out[3 * S * S + yy * S + xx] = dp / 32
    out[4 * S * S + yy * S + xx] = dn / 32
  }
  for (let i = 0; i < S * S; i++) { mu0 += cc[i * 3]; mu1 += cc[i * 3 + 1]; mu2 += cc[i * 3 + 2] }
  mu0 /= S * S; mu1 /= S * S; mu2 /= S * S
  for (let i = 0; i < S * S; i++) {
    out[i] = (cc[i * 3] - mu0) / 64; out[S * S + i] = (cc[i * 3 + 1] - mu1) / 64; out[2 * S * S + i] = (cc[i * 3 + 2] - mu2) / 64
  }
  return [out, x0 + half, y0 + half]
}

// ---------------------------------------------------------------- the network
export type Weights = Record<string, number[] | number[][] | number[][][] | number[][][][]>
type Conv = { w: Float32Array; b: Float32Array; cin: number; cout: number }
export class BallNet {
  c1: Conv; c2: Conv; c3: Conv; f1w: Float32Array; f1b: Float32Array; f2w: Float32Array; f2b: Float32Array; hid: number; nin: number
  constructor(W: Weights) {
    const conv = (k: string): Conv => {
      const w = W[k + '.weight'] as number[][][][]
      return { w: Float32Array.from(w.flat(3)), b: Float32Array.from(W[k + '.bias'] as number[]), cout: w.length, cin: w[0].length }
    }
    this.c1 = conv('c1'); this.c2 = conv('c2'); this.c3 = conv('c3')
    const f1 = W['f1.weight'] as number[][], f2 = W['f2.weight'] as number[][]
    this.hid = f1.length; this.nin = f1[0].length
    this.f1w = Float32Array.from(f1.flat()); this.f1b = Float32Array.from(W['f1.bias'] as number[])
    this.f2w = Float32Array.from(f2.flat()); this.f2b = Float32Array.from(W['f2.bias'] as number[])
  }
  private pad = new Float32Array(34 * 34 * 28)
  private convReluPool(x: Float32Array, s: number, L: Conv): Float32Array {
    // 3x3 convolution (zero padding), ReLU, then 2x2 max pool. The input is copied into a zero border once, so the
    // inner loop has no bounds checks and the 9 taps are unrolled.
    const { cin, cout, w, b } = L
    const S = s + 2, pad = this.pad
    pad.fill(0, 0, cin * S * S)
    for (let c = 0; c < cin; c++) for (let yy = 0; yy < s; yy++) {
      const src = c * s * s + yy * s, dst = c * S * S + (yy + 1) * S + 1
      for (let xx = 0; xx < s; xx++) pad[dst + xx] = x[src + xx]
    }
    const y = new Float32Array(cout * s * s)
    for (let o = 0; o < cout; o++) {
      const yo = o * s * s
      y.fill(b[o], yo, yo + s * s)
      for (let c = 0; c < cin; c++) {
        const wo = (o * cin + c) * 9, base = c * S * S
        const w0 = w[wo], w1 = w[wo + 1], w2 = w[wo + 2], w3 = w[wo + 3], w4 = w[wo + 4], w5 = w[wo + 5], w6 = w[wo + 6], w7 = w[wo + 7], w8 = w[wo + 8]
        for (let yy = 0; yy < s; yy++) {
          const r0 = base + yy * S, r1 = r0 + S, r2 = r1 + S, dst = yo + yy * s
          for (let xx = 0; xx < s; xx++) {
            y[dst + xx] += w0 * pad[r0 + xx] + w1 * pad[r0 + xx + 1] + w2 * pad[r0 + xx + 2]
              + w3 * pad[r1 + xx] + w4 * pad[r1 + xx + 1] + w5 * pad[r1 + xx + 2]
              + w6 * pad[r2 + xx] + w7 * pad[r2 + xx + 1] + w8 * pad[r2 + xx + 2]
          }
        }
      }
    }
    const t = s >> 1, out = new Float32Array(cout * t * t)
    for (let o = 0; o < cout; o++) for (let yy = 0; yy < t; yy++) for (let xx = 0; xx < t; xx++) {
      const i = o * s * s + 2 * yy * s + 2 * xx
      const m = Math.max(y[i], y[i + 1], y[i + s], y[i + s + 1])
      out[o * t * t + yy * t + xx] = m > 0 ? m : 0
    }
    return out
  }
  /** Returns [logit, dx, dy, radius]. */
  forward(x: Float32Array): [number, number, number, number] {
    let a = this.convReluPool(x, 32, this.c1)
    a = this.convReluPool(a, 16, this.c2)
    a = this.convReluPool(a, 8, this.c3)
    const hdn = new Float32Array(this.hid)
    for (let j = 0; j < this.hid; j++) {
      let s = this.f1b[j]; const o = j * this.nin
      for (let i = 0; i < this.nin; i++) s += this.f1w[o + i] * a[i]
      hdn[j] = Math.max(0, s)
    }
    const out = [0, 0, 0, 0]
    for (let j = 0; j < 4; j++) { let s = this.f2b[j]; for (let i = 0; i < this.hid; i++) s += this.f2w[j * this.hid + i] * hdn[i]; out[j] = s }
    return out as [number, number, number, number]
  }
}

export function detectFrame(prev: Frame, cur: Frame, nxt: Frame, net: BallNet, maxN = 60, pp?: [Prepped, Prepped, Prepped]): Det[] {
  const found: Det[] = []
  for (const [u, v] of candidates(prev, cur, nxt, maxN, 6, pp)) {
    const [x, cu, cv] = patch(prev, cur, nxt, u, v)
    const o = net.forward(x)
    const p = 1 / (1 + Math.exp(-o[0])), bu = cu + o[1], bv = cv + o[2]
    if (found.some(f => Math.hypot(bu - f[0], bv - f[1]) < 3)) continue
    found.push([bu, bv, p, Math.max(o[3], 0.5)])
  }
  return found
}

export function query(prev: Frame, cur: Frame, nxt: Frame, u: number, v: number, net: BallNet): Det {
  const [x, cu, cv] = patch(prev, cur, nxt, u, v)
  const o = net.forward(x)
  return [cu + o[1], cv + o[2], 1 / (1 + Math.exp(-o[0])), Math.max(o[3], 0.5)]
}

// ---------------------------------------------------------------- tracker
export type Track = { score: number; frames: [number, number, number, number, number][] } // frame, u, v, p, r
const logit = (p: number) => { p = Math.min(Math.max(p, 1e-4), 1 - 1e-4); return Math.log(p / (1 - p)) }

export function findTracks(dets: Det[][], fps: number, minLen = 6, maxTracks = 50, minScore = 0.25): Track[] {
  const n = dets.length
  const stepF = Math.max(1, Math.round(fps / 60)), maxGap = Math.max(2, Math.round(fps / 20))
  const pool = dets.map(fr => fr.filter(d => d[2] >= minScore))
  const seeds: [number, number, number][] = []
  pool.forEach((fr, i) => fr.forEach((d, j) => { if (d[2] >= 0.6) seeds.push([d[2], i, j]) }))
  seeds.sort((a, b) => b[0] - a[0] || b[1] - a[1] || b[2] - a[2])
  let tracks: [number, [number, number][]][] = []
  for (const [, i, j] of seeds.slice(0, 400)) {
    const a = pool[i][j]
    let best: [number, number, number] | null = null
    for (let gap = 1; gap <= 3 * stepF; gap++) {
      const k = i + gap; if (k >= n) break
      pool[k].forEach((b, jj) => {
        const dist = Math.hypot(b[0] - a[0], b[1] - a[1])
        if (dist > 0.3 * gap && dist < 120 * gap * 60 / fps && (!best || b[2] > best[0])) best = [b[2], k, jj]
      })
      if (best) break
    }
    if (!best) continue
    const b0 = best as [number, number, number]
    let chain: [number, number][] = [[i, j], [b0[1], b0[2]]]
    chain = grow(pool, chain, +1, maxGap)
    chain = grow(pool, chain.reverse(), -1, maxGap).reverse()
    if (chain.length < minLen) continue
    tracks.push([chain.reduce((s, [f, q]) => s + logit(pool[f][q][2]) + 2, 0), chain])
  }
  tracks.sort((a, b) => b[0] - a[0])
  tracks = merge(pool, tracks, maxGap)
  const out: Track[] = [], taken: [number, number][] = []
  for (const [sc, chain] of tracks) {
    const f0 = chain[0][0], f1 = chain[chain.length - 1][0]
    if (taken.some(([a, b]) => !(f1 < a || f0 > b))) continue
    taken.push([f0, f1])
    out.push({ score: sc, frames: chain.map(([f, q]) => [f, ...pool[f][q]] as [number, number, number, number, number]) })
    if (out.length >= maxTracks) break
  }
  return out
}

function grow(pool: Det[][], chain: [number, number][], dir: number, maxGap: number): [number, number][] {
  const n = pool.length
  for (;;) {
    const [f1, q1] = chain[chain.length - 2], [f2, q2] = chain[chain.length - 1]
    const p1 = pool[f1][q1], p2 = pool[f2][q2]
    const vel = [(p2[0] - p1[0]) / Math.abs(f2 - f1), (p2[1] - p1[1]) / Math.abs(f2 - f1)]
    let acc = [0, 0]
    if (chain.length >= 3) {
      const [f0, q0] = chain[chain.length - 3], p0 = pool[f0][q0]
      const v0 = [(p1[0] - p0[0]) / Math.abs(f1 - f0), (p1[1] - p0[1]) / Math.abs(f1 - f0)]
      const dd = Math.max(Math.abs(f2 - f0) / 2, 1)
      acc = [(vel[0] - v0[0]) / dd, (vel[1] - v0[1]) / dd]
    }
    let best: [number, number, number] | null = null
    for (let gap = 1; gap <= maxGap; gap++) {
      const f = f2 + dir * gap
      if (f < 0 || f >= n) break
      const pu = p2[0] + vel[0] * gap + 0.5 * acc[0] * gap * gap, pv = p2[1] + vel[1] * gap + 0.5 * acc[1] * gap * gap
      const sp = Math.hypot(vel[0], vel[1])
      const gu = 3 + 0.3 * sp * gap, gv = 3 + 0.3 * sp * gap + 2.2 * Math.abs(vel[1]) * gap
      pool[f].forEach((d, q) => {
        const du = (d[0] - pu) / gu, dv = (d[1] - pv) / gv, e = du * du + dv * dv
        if (e < 1 && (!best || e - 0.3 * d[2] < best[0])) best = [e - 0.3 * d[2], f, q]
      })
      if (best) break
    }
    if (!best) return chain
    const b = best as [number, number, number]
    chain.push([b[1], b[2]])
  }
}

function merge(pool: Det[][], tracks: [number, [number, number][]][], maxGap: number) {
  let changed = true
  while (changed) {
    changed = false
    outer: for (const a of tracks) {
      const fa = a[1][a[1].length - 1][0]
      for (const b of tracks) {
        if (a === b) continue
        const fb = b[1][0][0], gap = fb - fa
        if (!(gap > 0 && gap <= 3 * maxGap)) continue
        const [f1, q1] = a[1][a[1].length - 2], [f2, q2] = a[1][a[1].length - 1]
        const p1 = pool[f1][q1], p2 = pool[f2][q2]
        const vel = [(p2[0] - p1[0]) / (f2 - f1), (p2[1] - p1[1]) / (f2 - f1)]
        const pb = pool[fb][b[1][0][1]]
        const pu = p2[0] + vel[0] * gap, pv = p2[1] + vel[1] * gap, sp = Math.hypot(vel[0], vel[1])
        if (Math.abs(pb[0] - pu) < 4 + 0.4 * sp * gap && Math.abs(pb[1] - pv) < 4 + 2.5 * Math.abs(vel[1]) * gap + 0.4 * sp * gap) {
          a[1] = a[1].concat(b[1]); a[0] += b[0]
          tracks.splice(tracks.indexOf(b), 1)
          changed = true
          break outer
        }
      }
    }
  }
  return tracks.sort((x, y) => y[0] - x[0])
}

/** Fill the frames the first pass missed: inside the track by interpolation, and beyond both ends by
 *  extrapolation, asking the network to look exactly there. getFrame(i) returns frame i (or null). */
export function extendTrack(getFrame: (i: number) => Frame | null, nFrames: number, fps: number, track: Track, net: BallNet, pMin = 0.35): Track {
  const k = gapFor(fps)
  const pts = new Map<number, Det>(track.frames.map(([f, u, v, p, r]) => [f, [u, v, p, r]]))
  const q = (f: number, u: number, v: number): Det | null => {
    if (f - k < 0 || f + k >= nFrames) return null
    const a = getFrame(f - k), b = getFrame(f), c = getFrame(f + k)
    return a && b && c ? query(a, b, c, u, v, net) : null
  }
  const fs0 = [...pts.keys()].sort((a, b) => a - b)
  for (let j = 0; j + 1 < fs0.length; j++) {
    const a = fs0[j], b = fs0[j + 1], pa = pts.get(a)!, pb = pts.get(b)!
    for (let f = a + 1; f < b; f++) {
      const w = (f - a) / (b - a), u = pa[0] * (1 - w) + pb[0] * w, v = pa[1] * (1 - w) + pb[1] * w
      const d = q(f, u, v)
      if (d && d[2] >= pMin && Math.hypot(d[0] - u, d[1] - v) < 6) pts.set(f, d)
    }
  }
  const W = getFrame(fs0[0])?.w ?? 1e9, H = getFrame(fs0[0])?.h ?? 1e9
  for (const dir of [1, -1]) {
    let misses = 0
    while (misses < Math.max(3, Math.floor(fps / 30))) {
      const fs = [...pts.keys()].sort((a, b) => a - b)
      const end = dir > 0 ? fs[fs.length - 1] : fs[0]
      const near = dir > 0 ? fs.slice(-3) : fs.slice(0, 3).reverse()
      if (near.length < 3) break
      const f = end + dir * (misses + 1)
      if (f < k || f >= nFrames - k) break
      const P = near.map(x => pts.get(x)!)
      const pu = quadAt(near, P.map(p => p[0]), f), pv = quadAt(near, P.map(p => p[1]), f)
      if (!(pu >= 0 && pu < W && pv >= 0 && pv < H)) break
      const step = Math.hypot(P[2][0] - P[1][0], P[2][1] - P[1][1]) / Math.max(Math.abs(near[2] - near[1]), 1)
      const d = q(f, pu, pv)
      if (d && d[2] >= pMin && Math.hypot(d[0] - pu, d[1] - pv) < 3 + 0.5 * step * (misses + 1)) { pts.set(f, d); misses = 0 } else misses++
    }
  }
  return { score: track.score, frames: [...pts.keys()].sort((a, b) => a - b).map(f => [f, ...pts.get(f)!] as [number, number, number, number, number]) }
}

function quadAt(t: number[], y: number[], x: number): number {
  // the parabola through three points, evaluated at x (Lagrange form = an exact quadratic fit)
  const [t0, t1, t2] = t, [y0, y1, y2] = y
  if (t0 === t1 || t1 === t2 || t0 === t2) return y2 + (y2 - y1) * (x - t2) / ((t2 - t1) || 1)
  return y0 * (x - t1) * (x - t2) / ((t0 - t1) * (t0 - t2)) + y1 * (x - t0) * (x - t2) / ((t1 - t0) * (t1 - t2)) + y2 * (x - t0) * (x - t1) / ((t2 - t0) * (t2 - t1))
}
