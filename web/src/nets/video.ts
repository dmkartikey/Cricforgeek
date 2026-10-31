// Reading phone video frame by frame, in the browser, with exact frame times.
// MP4/MOV files are read directly (the sample table gives each frame's true time, which handles variable frame
// rates), frames are decoded by the browser's own hardware decoder (WebCodecs), and the phone's rotation flag is
// applied. Where WebCodecs is missing, frames come from seeking a <video> element instead.
import type { Frame } from './detect'

type Box = { type: string; start: number; size: number; hdr: number }

function boxes(dv: DataView, start: number, end: number): Box[] {
  const out: Box[] = []
  let p = start
  while (p + 8 <= end) {
    let size = dv.getUint32(p), hdr = 8
    const type = String.fromCharCode(dv.getUint8(p + 4), dv.getUint8(p + 5), dv.getUint8(p + 6), dv.getUint8(p + 7))
    if (size === 1) { size = Number(dv.getBigUint64(p + 8)); hdr = 16 } else if (size === 0) size = end - p
    if (size < hdr) break
    out.push({ type, start: p, size, hdr })
    p += size
  }
  return out
}
const child = (dv: DataView, b: Box, type: string, skip = 0) => boxes(dv, b.start + b.hdr + skip, b.start + b.size).find(x => x.type === type)

export type Track = {
  codec: string; description?: Uint8Array; width: number; height: number; rotation: number
  timescale: number; times: number[] /* presentation time of each sample, s, in decode order */
  sizes: number[]; offsets: number[]; sync: Set<number>; durationS: number; fpsNominal: number
}

/** Reads the video track's sample table from the file (only the 'moov' metadata is loaded). */
export async function readMp4(file: File): Promise<Track | null> {
  // find moov: scan top-level boxes by reading their headers only
  let p = 0, moov: { buf: ArrayBuffer; at: number } | null = null
  while (p < file.size) {
    const h = new DataView(await file.slice(p, p + 16).arrayBuffer())
    if (h.byteLength < 8) break
    let size = h.getUint32(0)
    const type = String.fromCharCode(h.getUint8(4), h.getUint8(5), h.getUint8(6), h.getUint8(7))
    if (size === 1) size = Number(h.getBigUint64(8)); else if (size === 0) size = file.size - p
    if (type === 'moov') { moov = { buf: await file.slice(p, p + size).arrayBuffer(), at: p }; break }
    if (size < 8) break
    p += size
  }
  if (!moov) return null
  const dv = new DataView(moov.buf)
  const root = boxes(dv, 0, moov.buf.byteLength)[0]
  for (const trak of boxes(dv, root.start + root.hdr, root.start + root.size).filter(b => b.type === 'trak')) {
    const mdia = child(dv, trak, 'mdia'); if (!mdia) continue
    const hdlr = child(dv, mdia, 'hdlr'); if (!hdlr) continue
    const ht = String.fromCharCode(...[0, 1, 2, 3].map(i => dv.getUint8(hdlr.start + hdlr.hdr + 8 + i)))
    if (ht !== 'vide') continue
    const mdhd = child(dv, mdia, 'mdhd')!
    const v = dv.getUint8(mdhd.start + mdhd.hdr)
    const timescale = dv.getUint32(mdhd.start + mdhd.hdr + (v === 1 ? 20 : 12))
    // rotation from the track header's matrix (phones store portrait video as landscape plus this flag)
    const tkhd = child(dv, trak, 'tkhd')!
    const tv = dv.getUint8(tkhd.start + tkhd.hdr)
    const mo = tkhd.start + tkhd.hdr + (tv === 1 ? 52 : 40)
    const a = dv.getInt32(mo) / 65536, b = dv.getInt32(mo + 4) / 65536
    const rotation = ((Math.round(Math.atan2(b, a) * 180 / Math.PI) % 360) + 360) % 360
    const stbl = child(dv, child(dv, mdia, 'minf')!, 'stbl')!
    const get = (t: string) => child(dv, stbl, t)
    // codec and its configuration record
    const stsd = get('stsd')!
    const entry = boxes(dv, stsd.start + stsd.hdr + 8, stsd.start + stsd.size)[0]
    const width = dv.getUint16(entry.start + entry.hdr + 24), height = dv.getUint16(entry.start + entry.hdr + 26)
    const cfgBoxes = boxes(dv, entry.start + entry.hdr + 78, entry.start + entry.size)
    let codec = '', description: Uint8Array | undefined
    const avcC = cfgBoxes.find(x => x.type === 'avcC'), hvcC = cfgBoxes.find(x => x.type === 'hvcC')
    const vpcC = cfgBoxes.find(x => x.type === 'vpcC'), av1C = cfgBoxes.find(x => x.type === 'av1C')
    const p2 = (n: number) => String(n).padStart(2, '0')
    if (avcC) {
      description = new Uint8Array(moov.buf, avcC.start + avcC.hdr, avcC.size - avcC.hdr)
      const hx = (n: number) => n.toString(16).padStart(2, '0')
      codec = `avc1.${hx(description[1])}${hx(description[2])}${hx(description[3])}`
    } else if (hvcC) {
      description = new Uint8Array(moov.buf, hvcC.start + hvcC.hdr, hvcC.size - hvcC.hdr)
      codec = hevcCodec(description, entry.type)
    } else if (vpcC) {
      // VP9: vp09.<profile>.<level>.<bit depth>
      const o = vpcC.start + vpcC.hdr + 4
      codec = `vp09.${p2(dv.getUint8(o))}.${p2(dv.getUint8(o + 1))}.${p2(dv.getUint8(o + 2) >> 4)}`
    } else if (av1C) {
      // AV1: av01.<profile>.<level><tier>.<bit depth>
      description = new Uint8Array(moov.buf, av1C.start + av1C.hdr, av1C.size - av1C.hdr)
      const b1 = description[1], b2 = description[2]
      const depth = (b2 & 0x40) ? ((b2 & 0x20) ? 12 : 10) : 8
      codec = `av01.${b1 >> 5}.${p2(b1 & 0x1f)}${(b2 & 0x80) ? 'H' : 'M'}.${p2(depth)}`
    } else codec = entry.type
    // sample times (stts + ctts), sizes (stsz), file offsets (stsc + stco/co64), key frames (stss)
    const stts = get('stts')!, n1 = dv.getUint32(stts.start + stts.hdr + 4)
    const dts: number[] = []
    let t = 0
    for (let i = 0; i < n1; i++) {
      const c = dv.getUint32(stts.start + stts.hdr + 8 + i * 8), d = dv.getUint32(stts.start + stts.hdr + 12 + i * 8)
      for (let j = 0; j < c; j++) { dts.push(t); t += d }
    }
    const comp = new Array(dts.length).fill(0)
    const ctts = get('ctts')
    if (ctts) {
      const cv = dv.getUint8(ctts.start + ctts.hdr), n = dv.getUint32(ctts.start + ctts.hdr + 4)
      let k = 0
      for (let i = 0; i < n; i++) {
        const c = dv.getUint32(ctts.start + ctts.hdr + 8 + i * 8)
        const o = cv === 1 ? dv.getInt32(ctts.start + ctts.hdr + 12 + i * 8) : dv.getUint32(ctts.start + ctts.hdr + 12 + i * 8)
        for (let j = 0; j < c && k < comp.length; j++) comp[k++] = o
      }
    }
    const stsz = get('stsz')!
    const fixed = dv.getUint32(stsz.start + stsz.hdr + 4), ns = dv.getUint32(stsz.start + stsz.hdr + 8)
    const sizes = Array.from({ length: ns }, (_, i) => fixed || dv.getUint32(stsz.start + stsz.hdr + 12 + i * 4))
    const stco = get('stco'), co64 = get('co64')
    const chunkOff: number[] = []
    if (stco) { const n = dv.getUint32(stco.start + stco.hdr + 4); for (let i = 0; i < n; i++) chunkOff.push(dv.getUint32(stco.start + stco.hdr + 8 + i * 4)) }
    else if (co64) { const n = dv.getUint32(co64.start + co64.hdr + 4); for (let i = 0; i < n; i++) chunkOff.push(Number(dv.getBigUint64(co64.start + co64.hdr + 8 + i * 8))) }
    const stsc = get('stsc')!, nsc = dv.getUint32(stsc.start + stsc.hdr + 4)
    const runs = Array.from({ length: nsc }, (_, i) => [0, 4].map(o => dv.getUint32(stsc.start + stsc.hdr + 8 + i * 12 + o)))
    const offsets: number[] = []
    let s = 0
    for (let r = 0; r < runs.length; r++) {
      const first = runs[r][0] - 1, last = r + 1 < runs.length ? runs[r + 1][0] - 1 : chunkOff.length
      for (let c = first; c < last; c++) {
        let off = chunkOff[c]
        for (let j = 0; j < runs[r][1] && s < sizes.length; j++) { offsets.push(off); off += sizes[s++] }
      }
    }
    const sync = new Set<number>()
    const stss = get('stss')
    if (stss) { const n = dv.getUint32(stss.start + stss.hdr + 4); for (let i = 0; i < n; i++) sync.add(dv.getUint32(stss.start + stss.hdr + 8 + i * 4) - 1) }
    else for (let i = 0; i < sizes.length; i++) sync.add(i)
    const pts = dts.map((d, i) => (d + comp[i]) / timescale)
    const p0 = Math.min(...pts)
    const times = pts.map(x => x - p0)
    const durationS = t / timescale
    return { codec, description, width, height, rotation, timescale, times, sizes, offsets, sync, durationS, fpsNominal: sizes.length / Math.max(durationS, 1e-6) }
  }
  return null
}

function hevcCodec(d: Uint8Array, fourcc: string): string {
  // hvc1.<profile space+profile>.<compat flags, bit-reversed hex>.<tier><level>.<constraint bytes>
  const space = ['', 'A', 'B', 'C'][d[1] >> 6], tier = (d[1] >> 5) & 1, prof = d[1] & 0x1f
  let compat = (d[2] << 24 | d[3] << 16 | d[4] << 8 | d[5]) >>> 0, rev = 0
  for (let i = 0; i < 32; i++) { rev = (rev << 1) | (compat & 1); compat >>>= 1 }
  const cons = [6, 7, 8, 9, 10, 11].map(i => d[i])
  while (cons.length && cons[cons.length - 1] === 0) cons.pop()
  const tail = cons.map(x => x.toString(16).toUpperCase()).join('.')
  return `${fourcc === 'hev1' ? 'hev1' : 'hvc1'}.${space}${prof}.${(rev >>> 0).toString(16).toUpperCase()}.${tier ? 'H' : 'L'}${d[12]}${tail ? '.' + tail : ''}`
}

/** Processing size: frames are scaled to at most 1280 px wide (the scale the ball network was trained at). */
export function procSize(w: number, h: number, rotation: number) {
  const [W0, H0] = rotation % 180 ? [h, w] : [w, h]
  const s = Math.min(1, 1280 / Math.max(W0, 1))
  return { W: Math.round(W0 * s), H: Math.round(H0 * s) }
}

export type FrameOut = { index: number; t: number; frame: Frame; bitmap?: ImageBitmap }

/** Decodes every frame in presentation order and hands each over (B, G, R float frames at processing size).
 *  `wantBitmap(i)` asks for a small picture of that frame too (for the tap screen and result clips). */
export async function decodeAll(file: File, track: Track, onFrame: (f: FrameOut) => Promise<void> | void,
  opts: { from?: number; to?: number; signal?: AbortSignal } = {}): Promise<void> {
  const { W, H } = procSize(track.width, track.height, track.rotation)
  const canvas = new OffscreenCanvas(W, H)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  const order = track.times.map((t, i) => [t, i] as [number, number]).sort((a, b) => a[0] - b[0])
  const presIndex = new Map<number, number>(order.map(([, s], k) => [s, k])) // sample -> frame number
  const from = opts.from ?? 0, to = Math.min(opts.to ?? order.length, order.length)
  // start decoding from the key frame at or before the first wanted frame (decode order)
  const firstSample = order[from][1]
  let start = 0
  for (let s = firstSample; s >= 0; s--) if (track.sync.has(s)) { start = s; break }
  const cfg: VideoDecoderConfig = { codec: track.codec, description: track.description, codedWidth: track.width, codedHeight: track.height, optimizeForLatency: true }
  const sup = await VideoDecoder.isConfigSupported(cfg).catch(() => ({ supported: false }))
  if (!sup.supported) throw new Error(`This browser can't decode this video's format (${track.codec}). Try Chrome or Safari, or record in "Most compatible" (H.264) mode.`)
  const pending: VideoFrame[] = []
  let error: unknown = null
  const dec = new VideoDecoder({ output: f => pending.push(f), error: e => { error = e } })
  dec.configure(cfg)
  const toFrame = (vf: VideoFrame): Frame => {
    ctx.save()
    if (track.rotation) {
      ctx.translate(W / 2, H / 2); ctx.rotate(track.rotation * Math.PI / 180)
      const [dw, dh] = track.rotation % 180 ? [H, W] : [W, H]
      ctx.drawImage(vf, -dw / 2, -dh / 2, dw, dh)
    } else ctx.drawImage(vf, 0, 0, W, H)
    ctx.restore()
    const px = ctx.getImageData(0, 0, W, H).data
    const d = new Float32Array(W * H * 3)
    for (let i = 0, j = 0; i < px.length; i += 4, j += 3) { d[j] = px[i + 2]; d[j + 1] = px[i + 1]; d[j + 2] = px[i] }
    return { w: W, h: H, d }
  }
  const drain = async () => {
    pending.sort((a, b) => a.timestamp - b.timestamp)
    while (pending.length) {
      const vf = pending.shift()!
      const k = Math.round(vf.timestamp) // we stamp chunks with their frame number
      if (k >= from && k < to) await onFrame({ index: k, t: order[k][0], frame: toFrame(vf) })
      vf.close()
    }
  }
  const end = Math.max(...order.slice(from, to).map(([, s]) => s)) + 1
  for (let s = start; s < Math.min(end + 16, track.sizes.length); s++) {
    if (opts.signal?.aborted) break
    if (error || dec.state === 'closed') throw error ?? new Error('The video decoder stopped')
    const data = new Uint8Array(await file.slice(track.offsets[s], track.offsets[s] + track.sizes[s]).arrayBuffer())
    dec.decode(new EncodedVideoChunk({ type: track.sync.has(s) ? 'key' : 'delta', timestamp: presIndex.get(s)!, data }))
    // keep memory in check: let the decoder catch up every few frames
    while (dec.decodeQueueSize > 8) await new Promise(r => setTimeout(r, 2))
    if (pending.length > 12) {
      // frames come out in presentation order once enough have been decoded; hand over all but the newest few
      pending.sort((a, b) => a.timestamp - b.timestamp)
      const keep = pending.splice(pending.length - 6)
      const ready = pending.splice(0)
      pending.push(...keep)
      for (const vf of ready) {
        const k = Math.round(vf.timestamp)
        if (k >= from && k < to) await onFrame({ index: k, t: order[k][0], frame: toFrame(vf) })
        vf.close()
      }
    }
  }
  await dec.flush()
  await drain()
  dec.close()
  if (error) throw error
}

export function webCodecsOk() {
  return typeof (globalThis as { VideoDecoder?: unknown }).VideoDecoder === 'function' && typeof OffscreenCanvas === 'function'
}

/** Fallback: seek a <video> element to each frame's time and grab it (slower, but works everywhere). */
export async function decodeBySeeking(file: File, fps: number, onFrame: (f: FrameOut) => Promise<void> | void,
  opts: { from?: number; to?: number; signal?: AbortSignal } = {}): Promise<{ W: number; H: number; n: number }> {
  const url = URL.createObjectURL(file)
  const v = document.createElement('video')
  v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url
  await new Promise<void>((ok, bad) => { v.onloadeddata = () => ok(); v.onerror = () => bad(new Error('This video could not be opened')) })
  const { W, H } = procSize(v.videoWidth, v.videoHeight, 0)
  const c = document.createElement('canvas'); c.width = W; c.height = H
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  const n = Math.floor(v.duration * fps)
  for (let k = opts.from ?? 0; k < Math.min(opts.to ?? n, n); k++) {
    if (opts.signal?.aborted) break
    v.currentTime = (k + 0.5) / fps
    await new Promise<void>(ok => { v.onseeked = () => ok() })
    ctx.drawImage(v, 0, 0, W, H)
    const px = ctx.getImageData(0, 0, W, H).data
    const d = new Float32Array(W * H * 3)
    for (let i = 0, j = 0; i < px.length; i += 4, j += 3) { d[j] = px[i + 2]; d[j + 1] = px[i + 1]; d[j + 2] = px[i] }
    await onFrame({ index: k, t: k / fps, frame: { w: W, h: H, d } })
  }
  URL.revokeObjectURL(url)
  return { W, H, n }
}
