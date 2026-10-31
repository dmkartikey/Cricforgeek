// Background worker for the nets analyser. Each worker decodes its own stretch of the clip and looks for the ball in
// every frame; another job fills in a found track. Nothing leaves the device.
import { BallNet, prepFrame, detectFrame, extendTrack, gapFor, Frame, Prepped, Det, Track as BallTrack } from './detect'
import { decodeAll, Track } from './video'
import { fitSession, Tap, Obs } from './fit'

type Msg =
  | { type: 'detect'; file: File; track: Track; from: number; to: number; fps: number; weights: unknown; step?: number; id: number }
  | { type: 'extend'; file: File; track: Track; fps: number; weights: unknown; tracks: BallTrack[]; nFrames: number; id: number }
  | { type: 'fit'; taps: Tap[]; balls: Obs[][]; W: number; H: number; readout: number; hfov?: number; sigF?: number; id: number }

let net: BallNet | null = null
const getNet = (w: unknown) => (net ??= new BallNet(w as ConstructorParameters<typeof BallNet>[0]))
const post = (m: unknown) => (self as unknown as Worker).postMessage(m)

self.onmessage = async (ev: MessageEvent<Msg>) => {
  const m = ev.data
  try {
    if (m.type === 'detect') await detect(m)
    else if (m.type === 'extend') await extend(m)
    else if (m.type === 'fit') {
      const out = fitSession(m.taps, m.balls, m.W, m.H, m.readout, m.hfov, (d, t) => post({ type: 'progress', id: m.id, done: d, total: t }), m.sigF)
      post({ type: 'done', id: m.id, result: out })
    }
  } catch (e) {
    post({ type: 'error', id: m.id, message: e instanceof Error ? e.message : String(e) })
  }
}

async function detect(m: Extract<Msg, { type: 'detect' }>) {
  const nn = getNet(m.weights)
  const k = gapFor(m.fps)
  // frames from..to are analysed; each needs the frames k before and k after, so decode a little wider
  const lo = Math.max(0, m.from - k), hi = Math.min(m.track.times.length, m.to + k)
  const ring = new Map<number, { f: Frame; p: Prepped }>()
  const dets: [number, Det[]][] = []
  let done = 0
  await decodeAll(m.file, m.track, async ({ index, frame }) => {
    ring.set(index, { f: frame, p: prepFrame(frame) })
    const i = index - k // the frame that now has both neighbours
    if (i >= m.from && i < m.to && i % (m.step ?? 1) === 0 && ring.has(i - k) && ring.has(i)) {
      const a = ring.get(i - k)!, b = ring.get(i)!, c = ring.get(index)!
      dets.push([i, detectFrame(a.f, b.f, c.f, nn, 60, [a.p, b.p, c.p])])
      if (++done % 4 === 0) post({ type: 'progress', id: m.id, done: done * (m.step ?? 1), total: m.to - m.from })
    }
    for (const key of ring.keys()) if (key < index - 2 * k) ring.delete(key)
  }, { from: lo, to: hi })
  post({ type: 'done', id: m.id, result: dets })
}

async function extend(m: Extract<Msg, { type: 'extend' }>) {
  // decode the stretch around each track, keeping only a crop around the ball's path, then let the network look
  // exactly where the flight says the ball should be in the frames the first pass missed
  const nn = getNet(m.weights)
  const k = gapFor(m.fps)
  const out: BallTrack[] = []
  for (let ti = 0; ti < m.tracks.length; ti++) {
    const t = m.tracks[ti]
    const f0 = t.frames[0][0], f1 = t.frames[t.frames.length - 1][0]
    const margin = Math.max(6, Math.round(m.fps * 0.25))
    const lo = Math.max(0, f0 - margin - k), hi = Math.min(m.nFrames, f1 + margin + k + 1)
    const us = t.frames.map(x => x[1]), vs = t.frames.map(x => x[2])
    const pad = 140
    const cx0 = Math.max(0, Math.floor(Math.min(...us) - pad)), cy0 = Math.max(0, Math.floor(Math.min(...vs) - pad))
    const crops = new Map<number, Frame>()
    let cw = 0, ch = 0
    await decodeAll(m.file, m.track, ({ index, frame }) => {
      cw = Math.min(frame.w - cx0, Math.ceil(Math.max(...us) + pad) - cx0); ch = Math.min(frame.h - cy0, Math.ceil(Math.max(...vs) + pad) - cy0)
      const d = new Float32Array(cw * ch * 3)
      for (let y = 0; y < ch; y++) d.set(frame.d.subarray(((y + cy0) * frame.w + cx0) * 3, ((y + cy0) * frame.w + cx0 + cw) * 3), y * cw * 3)
      crops.set(index, { w: cw, h: ch, d })
    }, { from: lo, to: hi })
    const shifted: BallTrack = { score: t.score, frames: t.frames.map(([f, u, v, p, r]) => [f, u - cx0, v - cy0, p, r]) }
    const ext = extendTrack(i => crops.get(i) ?? null, m.nFrames, m.fps, shifted, nn)
    out.push({ score: t.score, frames: ext.frames.map(([f, u, v, p, r]) => [f, u + cx0, v + cy0, p, r]) })
    post({ type: 'progress', id: m.id, done: ti + 1, total: m.tracks.length })
  }
  post({ type: 'done', id: m.id, result: out })
}

