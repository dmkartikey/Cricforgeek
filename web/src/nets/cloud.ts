// The nets analysis on cricforgeek's cloud analyser: the clip goes to private storage through a one-time link, the
// server analyses it (the same results on every phone, in seconds) and deletes it straight away.
import type { Analysis, Progress } from './analyse'
import type { Tap } from './fit'

export const CLOUD_API = (import.meta.env.VITE_NETS_API as string | undefined) || ''

export async function analyseCloud(file: File, taps: Tap[], W: number, H: number,
  opts: { slow?: number; lens?: string; onProgress?: (p: Progress) => void; signal?: AbortSignal } = {}): Promise<Analysis> {
  const say = (stage: Progress['stage'], done: number, total: number) => opts.onProgress?.({ stage, done, total })
  say('uploading', 0, 1)
  const type = file.type && file.type.startsWith('video/') ? file.type : 'video/mp4'
  const up = await fetch(`${CLOUD_API}/v1/upload`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ size: file.size, type }), signal: opts.signal })
  if (!up.ok) throw new Error(await reason(up))
  const { job, url } = await up.json() as { job: string; url: string }
  await put(url, file, type, (d, t) => say('uploading', d, t), opts.signal)
  const res = await fetch(`${CLOUD_API}/v1/analyse`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, signal: opts.signal,
    body: JSON.stringify({ job, taps, W, H, slow: opts.slow ?? 1, lens: opts.lens ?? 'normal' }),
  })
  if (!res.ok || !res.body) throw new Error(await reason(res))
  const reader = res.body.getReader(), dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1)
      if (!line) continue
      const m = JSON.parse(line)
      if (m.type === 'progress') say(m.stage === 'decoding' ? 'loading' : m.stage, m.done, m.total)
      else if (m.type === 'done') return m.result as Analysis
      else if (m.type === 'error') throw new Error(m.message)
    }
  }
  throw new Error('The connection to the analyser closed early. Please try again.')
}

function put(url: string, file: File, type: string, onProgress: (d: number, t: number) => void, signal?: AbortSignal) {
  // XMLHttpRequest, because fetch can't report upload progress
  return new Promise<void>((ok, bad) => {
    const x = new XMLHttpRequest()
    x.open('PUT', url)
    x.setRequestHeader('content-type', type)
    x.upload.onprogress = e => onProgress(e.loaded, e.total || file.size)
    x.onload = () => (x.status >= 200 && x.status < 300 ? ok() : bad(new Error('The upload failed. Please try again.')))
    x.onerror = () => bad(new Error('The upload failed. Check your connection and try again.'))
    signal?.addEventListener('abort', () => x.abort())
    x.send(file)
  })
}

async function reason(r: Response) {
  try { const j = await r.json(); if (j?.detail) return String(j.detail) } catch { /* not JSON */ }
  return r.status === 429 ? 'Too many analyses from this connection just now. Please try again later.' : 'The analyser is unavailable right now. Please try again.'
}

/** A still frame without WebCodecs: seek a <video> element (works in every browser). */
export async function stillByVideo(file: File, at = 1 / 3): Promise<{ img: ImageData; w: number; h: number; duration: number }> {
  const url = URL.createObjectURL(file)
  try {
    const v = document.createElement('video')
    v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url
    await new Promise<void>((ok, bad) => { v.onloadeddata = () => ok(); v.onerror = () => bad(new Error('This video could not be opened.')) })
    v.currentTime = v.duration * at
    await new Promise<void>(ok => { v.onseeked = () => ok() })
    const s = Math.min(1, 1280 / Math.max(v.videoWidth, 1))
    const w = Math.round(v.videoWidth * s), h = Math.round(v.videoHeight * s)
    const c = document.createElement('canvas'); c.width = w; c.height = h
    const ctx = c.getContext('2d')!
    ctx.drawImage(v, 0, 0, w, h)
    return { img: ctx.getImageData(0, 0, w, h), w, h, duration: v.duration }
  } finally { URL.revokeObjectURL(url) }
}
