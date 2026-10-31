// Runs the whole analysis on the user's device: split the clip across background workers to find the ball in every
// frame, chain the sightings into flights, fill in the frames missed, then calibrate and fit every delivery.
import { findTracks, Det, Track as BallTrack } from './detect'
import type { Track } from './video'
import type { Tap, Obs, Result } from './fit'
import type { Cam } from './geom'

export type Stage = 'uploading' | 'loading' | 'finding' | 'tracking' | 'measuring'
export type Progress = { stage: Stage; done: number; total: number }
export type Delivery = { track: BallTrack; obs: Obs[]; result: Result | null; tStart: number; shot?: import('./coach').Shot }
export type Analysis = { cam: Cam; calibRms: number; deliveries: Delivery[]; fps: number; framesSeen: number }

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; onProgress?: (d: number, t: number) => void }

class Pool {
  workers: Worker[] = []
  pend = new Map<number, Pending>()
  next = 1
  constructor(n: number) {
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
      w.onmessage = (ev: MessageEvent<{ type: string; id: number; done?: number; total?: number; result?: unknown; message?: string }>) => {
        const m = ev.data, p = this.pend.get(m.id)
        if (!p) return
        if (m.type === 'progress') p.onProgress?.(m.done!, m.total!)
        else if (m.type === 'done') { this.pend.delete(m.id); p.resolve(m.result) }
        else if (m.type === 'error') { this.pend.delete(m.id); p.reject(new Error(m.message)) }
      }
      this.workers.push(w)
    }
  }
  run<T>(i: number, msg: Record<string, unknown>, onProgress?: (d: number, t: number) => void): Promise<T> {
    const id = this.next++
    return new Promise<T>((resolve, reject) => {
      this.pend.set(id, { resolve: resolve as (v: unknown) => void, reject, onProgress })
      this.workers[i % this.workers.length].postMessage({ ...msg, id })
    })
  }
  close() { this.workers.forEach(w => w.terminate()) }
}

let weightsCache: unknown = null
async function weights() {
  if (!weightsCache) {
    const r = await fetch('/nets-assets/ballnet.json')
    if (!r.ok) throw new Error('The ball model could not be loaded')
    weightsCache = (await r.json()).weights
  }
  return weightsCache
}

/** slow: how many times slower than real life the file plays (1 normal; 4 or 8 for slow-motion exports). */
export async function analyse(file: File, track: Track, taps: Tap[], W: number, H: number,
  opts: { slow?: number; readout?: number; lens?: 'normal' | 'zoomed' | 'wide'; onProgress?: (p: Progress) => void; signal?: AbortSignal } = {}): Promise<Analysis> {
  const slow = opts.slow ?? 1
  // frame times in presentation order, in real seconds
  const times = [...track.times].sort((a, b) => a - b).map(t => t / slow)
  const n = times.length
  const fps = (n - 1) / Math.max(times[n - 1] - times[0], 1e-6)
  const readout = opts.readout ?? 0.65 / fps
  opts.onProgress?.({ stage: 'loading', done: 0, total: 1 })
  const w = await weights()
  const nw = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1))
  const pool = new Pool(nw)
  try {
    // 1. find the ball in every frame, the clip split into one stretch per worker
    const dets: Det[][] = Array.from({ length: n }, () => [])
    const seg = Math.ceil(n / nw)
    const doneBy = new Array(nw).fill(0)
    const report = () => opts.onProgress?.({ stage: 'finding', done: doneBy.reduce((a, b) => a + b, 0), total: n })
    await Promise.all(Array.from({ length: nw }, (_, i) => pool.run<[number, Det[]][]>(i,
      { type: 'detect', file, track, from: i * seg, to: Math.min(n, (i + 1) * seg), fps, weights: w },
      d => { doneBy[i] = d; report() }).then(res => { for (const [f, d] of res) dets[f] = d })))
    if (opts.signal?.aborted) throw new Error('Stopped')
    // 2. chain into flights, keep the ones that look like deliveries
    opts.onProgress?.({ stage: 'tracking', done: 0, total: 1 })
    const minLen = Math.max(6, Math.round(fps * 0.12))
    let tracks = findTracks(dets, fps, minLen).filter(t => plausible(t, fps))
    tracks = tracks.sort((a, b) => a.frames[0][0] - b.frames[0][0])
    if (tracks.length) {
      tracks = await pool.run<BallTrack[]>(0, { type: 'extend', file, track, fps, weights: w, tracks, nFrames: n },
        (d, t) => opts.onProgress?.({ stage: 'tracking', done: d, total: t }))
    }
    // 3. calibrate and measure every delivery together
    const balls: Obs[][] = tracks.map(t => t.frames.map(([f, u, v, , r]) => ({ t: times[f], u, v, r })))
    opts.onProgress?.({ stage: 'measuring', done: 0, total: Math.max(1, balls.length * 3) })
    const fit = await pool.run<{ cam: Cam; results: (Result | null)[]; calibRms: number }>(0,
      { type: 'fit', taps, balls, W, H, readout, ...lensPrior(opts.lens, W, H) },
      (d, t) => opts.onProgress?.({ stage: 'measuring', done: d, total: t }))
    // keep what moves like a bowled ball: a believable speed, past the batter's stumps below head height, a tight
    // fit and a usable uncertainty (people walking about make chains too, but not ones like this)
    const deliveries = tracks.map((t, i) => ({ track: t, obs: balls[i], result: fit.results[i], tStart: times[t.frames[0][0]] }))
      .filter(d => isDelivery(d.result))
    // only one ball is in the air at a time: overlapping flights are pieces of the same delivery; keep the tighter one
    const quality = (d: Delivery) => (d.result?.speedSd ?? 99) / Math.sqrt(Math.max(d.obs.length, 1))
    const kept: Delivery[] = []
    for (const d of deliveries.sort((a, b) => a.tStart - b.tStart)) {
      const t0 = d.obs[0].t, t1 = d.obs[d.obs.length - 1].t
      const k = kept.findIndex(o => !(t1 < o.obs[0].t || t0 > o.obs[o.obs.length - 1].t))
      if (k < 0) kept.push(d)
      else if (quality(d) < quality(kept[k])) kept[k] = d
    }
    return { cam: fit.cam, calibRms: fit.calibRms, deliveries: kept, fps, framesSeen: n }
  } finally {
    pool.close()
  }
}

export function isDelivery(r: Result | null): boolean {
  if (!r) return false
  if (!(r.speedKmh >= 40 && r.speedKmh <= 170)) return false
  if ((r.speedSd ?? 0) > 15 || r.rmsPx > 4) return false
  if (r.heightZ === undefined || r.heightZ < 0 || r.heightZ > 3) return false
  if (r.lineY === undefined || Math.abs(r.lineY) > 2.5) return false
  if (r.lengthM !== undefined && (r.lengthM < -1.5 || r.lengthM > 15)) return false
  return true
}

/** A delivery travels away from the camera for a good part of a second: drop short or static chains. */
function plausible(t: BallTrack, fps: number) {
  const f = t.frames
  const span = (f[f.length - 1][0] - f[0][0]) / fps
  const dist = Math.hypot(f[f.length - 1][1] - f[0][1], f[f.length - 1][2] - f[0][2])
  return span >= 0.1 && dist >= 15
}

/** What the user told us about the lens. Phones' normal (1x) camera films about 62-76 degrees wide in landscape;
 *  the ultra-wide (0.5x) about 100-110. "Zoomed" leaves the width to the taps. Portrait clips see the narrow side. */
function lensPrior(lens: 'normal' | 'zoomed' | 'wide' | undefined, W: number, H: number): { hfov?: number; sigF?: number } {
  if (!lens || lens === 'zoomed') return {}
  const land = lens === 'wide' ? 105 : 69
  if (W >= H) return { hfov: land, sigF: 0.12 }
  // portrait: same lens, so the same focal length in pixels; the picture's width is now the sensor's short side
  const t = (W / H) * Math.tan((land * Math.PI) / 360)
  return { hfov: (2 * Math.atan(t) * 180) / Math.PI, sigF: 0.15 }
}
