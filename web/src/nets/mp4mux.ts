// A small MP4 writer: encoded video samples (from the browser's VideoEncoder) plus their exact times in, a playable
// .mp4 file out. One video track, one chunk, no audio. Used to turn a screen capture of a video into an ordinary file
// that the analyser reads like any upload.

export type Sample = { data: Uint8Array; timeUs: number; key: boolean }
export type TrackInfo = { codec: string; width: number; height: number; description?: Uint8Array }

const TS = 90000 // media timescale (ticks per second)

class W {
  parts: Uint8Array[] = []
  size = 0
  u8(v: number) { this.push(new Uint8Array([v & 255])) }
  u16(v: number) { this.push(new Uint8Array([(v >> 8) & 255, v & 255])) }
  u32(v: number) { this.push(new Uint8Array([(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255])) }
  str(s: string) { this.push(new Uint8Array([...s].map(c => c.charCodeAt(0)))) }
  zeros(n: number) { this.push(new Uint8Array(n)) }
  push(b: Uint8Array) { this.parts.push(b); this.size += b.length }
  bytes() { const o = new Uint8Array(this.size); let p = 0; for (const b of this.parts) { o.set(b, p); p += b.length } return o }
}

function box(type: string, ...children: (Uint8Array | ((w: W) => void))[]): Uint8Array {
  const w = new W()
  for (const c of children) { if (c instanceof Uint8Array) w.push(c); else c(w) }
  const body = w.bytes()
  const o = new W(); o.u32(body.length + 8); o.str(type); o.push(body)
  return o.bytes()
}
const full = (type: string, version: number, flags: number, f: (w: W) => void, ...kids: Uint8Array[]) =>
  box(type, w => { w.u32((version << 24) | flags); f(w) }, ...kids)
const MATRIX = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000]

/** Codec configuration box for the sample entry. */
function configBox(t: TrackInfo): Uint8Array {
  if (t.codec.startsWith('avc1') || t.codec.startsWith('avc3')) return box('avcC', t.description ?? new Uint8Array())
  if (t.codec.startsWith('hvc1') || t.codec.startsWith('hev1')) return box('hvcC', t.description ?? new Uint8Array())
  if (t.codec.startsWith('av01')) return box('av1C', t.description ?? new Uint8Array())
  // vp09.PP.LL.DD
  const [, pp, ll, dd] = t.codec.split('.').map(Number)
  return full('vpcC', 1, 0, w => { w.u8(pp || 0); w.u8(ll || 10); w.u8(((dd || 8) << 4) | (1 << 1)); w.u8(1); w.u8(1); w.u8(1); w.u16(0) })
}

export function muxMp4(track: TrackInfo, samples: Sample[]): Uint8Array {
  const n = samples.length
  if (!n) throw new Error('Nothing was captured.')
  const t0 = samples[0].timeUs
  const ticks = samples.map(s => Math.round(((s.timeUs - t0) * TS) / 1e6))
  const deltas = ticks.map((t, i) => (i + 1 < n ? Math.max(1, ticks[i + 1] - t) : 0))
  const sorted = deltas.slice(0, -1).sort((a, b) => a - b)
  deltas[n - 1] = sorted.length ? sorted[sorted.length >> 1] : Math.round(TS / 30)
  const duration = deltas.reduce((a, b) => a + b, 0)
  const entry = track.codec.startsWith('avc') ? 'avc1' : track.codec.startsWith('hvc1') || track.codec.startsWith('hev1') ? 'hvc1' : track.codec.startsWith('av01') ? 'av01' : 'vp09'

  const ftyp = box('ftyp', w => { w.str('isom'); w.u32(0x200); w.str('isom'); w.str('iso2'); w.str(entry === 'avc1' ? 'avc1' : 'iso6'); w.str('mp41') })
  const payload = samples.reduce((a, s) => a + s.data.length, 0)
  const mdatHead = new W(); mdatHead.u32(payload + 8); mdatHead.str('mdat')
  const dataOffset = ftyp.length + 8

  // run-length time-to-sample table
  const runs: [number, number][] = []
  for (const d of deltas) { const last = runs[runs.length - 1]; if (last && last[1] === d) last[0]++; else runs.push([1, d]) }
  const keys = samples.map((s, i) => (s.key ? i + 1 : 0)).filter(Boolean)

  const stsd = full('stsd', 0, 0, w => w.u32(1), box(entry, w => {
    w.zeros(6); w.u16(1); w.zeros(16); w.u16(track.width); w.u16(track.height)
    w.u32(0x00480000); w.u32(0x00480000); w.u32(0); w.u16(1); w.zeros(32); w.u16(0x18); w.u16(0xffff)
  }, configBox(track)))
  const stbl = box('stbl', stsd,
    full('stts', 0, 0, w => { w.u32(runs.length); for (const [c, d] of runs) { w.u32(c); w.u32(d) } }),
    full('stss', 0, 0, w => { w.u32(keys.length); for (const k of keys) w.u32(k) }),
    full('stsc', 0, 0, w => { w.u32(1); w.u32(1); w.u32(n); w.u32(1) }),
    full('stsz', 0, 0, w => { w.u32(0); w.u32(n); for (const s of samples) w.u32(s.data.length) }),
    full('stco', 0, 0, w => { w.u32(1); w.u32(dataOffset) }))
  const minf = box('minf', full('vmhd', 0, 1, w => w.zeros(8)),
    box('dinf', full('dref', 0, 0, w => w.u32(1), full('url ', 0, 1, () => undefined))), stbl)
  const mdia = box('mdia',
    full('mdhd', 0, 0, w => { w.u32(0); w.u32(0); w.u32(TS); w.u32(duration); w.u16(0x55c4); w.u16(0) }),
    full('hdlr', 0, 0, w => { w.u32(0); w.str('vide'); w.zeros(12); w.str('VideoHandler'); w.u8(0) }), minf)
  const durMs = Math.round((duration * 1000) / TS)
  const tkhd = full('tkhd', 0, 3, w => {
    w.u32(0); w.u32(0); w.u32(1); w.u32(0); w.u32(durMs); w.zeros(8); w.u16(0); w.u16(0); w.u16(0); w.u16(0)
    for (const m of MATRIX) w.u32(m)
    w.u32(track.width << 16); w.u32(track.height << 16)
  })
  const mvhd = full('mvhd', 0, 0, w => {
    w.u32(0); w.u32(0); w.u32(1000); w.u32(durMs); w.u32(0x00010000); w.u16(0x0100); w.zeros(10)
    for (const m of MATRIX) w.u32(m)
    w.zeros(24); w.u32(2)
  })
  const moov = box('moov', mvhd, box('trak', tkhd, mdia))

  const out = new Uint8Array(ftyp.length + 8 + payload + moov.length)
  let p = 0
  out.set(ftyp, p); p += ftyp.length
  out.set(mdatHead.bytes(), p); p += 8
  for (const s of samples) { out.set(s.data, p); p += s.data.length }
  out.set(moov, p)
  return out
}
