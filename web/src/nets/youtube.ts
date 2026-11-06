// Analysing a YouTube video without downloading it: the video plays in YouTube's own embedded player on our page,
// and the visitor lets the page capture that part of their screen (like a screen recorder). It plays at quarter speed
// so no frame is missed; each new frame is kept once with its exact time in the video, and the frames are encoded
// into an ordinary video file that goes through the analyser like an upload. Nothing is fetched from YouTube's servers
// and nothing leaves the visitor's device until they choose to analyse it.
import { muxMp4, Sample } from './mp4mux'

export function youTubeId(url: string): string | null {
  try {
    const u = new URL(url.trim())
    const h = u.hostname.replace(/^www\.|^m\./, '')
    if (h === 'youtu.be') return u.pathname.slice(1, 12) || null
    if (h === 'youtube.com' || h === 'youtube-nocookie.com' || h === 'music.youtube.com') {
      if (u.searchParams.get('v')) return u.searchParams.get('v')!.slice(0, 11)
      const m = u.pathname.match(/\/(?:embed|shorts|live|v)\/([\w-]{11})/)
      return m ? m[1] : null
    }
  } catch { /* not a URL */ }
  return null
}

export const captureSupported = () =>
  typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia && typeof (globalThis as { VideoEncoder?: unknown }).VideoEncoder === 'function'

const YT_ORIGIN = 'https://www.youtube-nocookie.com'

export function embedUrl(id: string) {
  const q = new URLSearchParams({ enablejsapi: '1', controls: '0', disablekb: '1', modestbranding: '1', rel: '0', playsinline: '1',
    iv_load_policy: '3', fs: '0', origin: location.origin })
  return `${YT_ORIGIN}/embed/${id}?${q}`
}

/** What the capture needs from a player: YouTube's embed below, or a plain <video> in tests. */
export interface PlayerLike {
  ready: Promise<void>
  time(): number
  duration(): number
  playing(): boolean
  seek(s: number): void
  play(): void
  pause(): void
  setRate(r: number): void
  onTick?: (t: number) => void
  destroy(): void
}

/** YouTube's embedded player, driven through its documented postMessage interface (no YouTube script on our page). */
export class YouTubePlayer implements PlayerLike {
  private t = 0; private dur = 0; private state = -1; private lastAt = 0; private rate = 1
  private readyRes!: () => void
  ready = new Promise<void>(r => { this.readyRes = r })
  private listen: number
  onTick?: (t: number) => void
  constructor(private iframe: HTMLIFrameElement) {
    window.addEventListener('message', this.onMsg)
    // ask the player to start sending its state
    this.listen = window.setInterval(() => this.post({ event: 'listening', id: 'nets', channel: 'widget' }), 250)
  }
  private post(m: object) { this.iframe.contentWindow?.postMessage(JSON.stringify(m), YT_ORIGIN) }
  private cmd(func: string, args: unknown[] = []) { this.post({ event: 'command', func, args, id: 'nets', channel: 'widget' }) }
  private onMsg = (e: MessageEvent) => {
    if (e.source !== this.iframe.contentWindow || !/^https:\/\/www\.youtube(-nocookie)?\.com$/.test(e.origin)) return
    let d: { event?: string; info?: Record<string, unknown> | number }
    try { d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data } catch { return }
    if (d.event === 'onReady' || d.event === 'initialDelivery') { window.clearInterval(this.listen); this.readyRes() }
    const info = d.info
    if (info && typeof info === 'object') {
      if (typeof info.currentTime === 'number') { this.t = info.currentTime; this.lastAt = performance.now(); this.onTick?.(this.t) }
      if (typeof info.duration === 'number') this.dur = info.duration
      if (typeof info.playerState === 'number') this.state = info.playerState
      if (typeof info.playbackRate === 'number') this.rate = info.playbackRate
    } else if (d.event === 'onStateChange' && typeof info === 'number') this.state = info
  }
  /** The latest reported time, carried forward by the clock while playing (reports arrive a few times a second). */
  time() { return this.state === 1 ? this.t + ((performance.now() - this.lastAt) / 1000) * this.rate : this.t }
  duration() { return this.dur }
  playing() { return this.state === 1 }
  seek(s: number) { this.cmd('seekTo', [s, true]); this.t = s; this.lastAt = performance.now() }
  play() { this.cmd('playVideo') }
  pause() { this.cmd('pauseVideo') }
  setRate(r: number) { this.cmd('setPlaybackRate', [r]); this.rate = r }
  destroy() { window.clearInterval(this.listen); window.removeEventListener('message', this.onMsg) }
}

export type CaptureProgress = { stage: 'waiting' | 'capturing' | 'encoding'; done: number; total: number }
export type Captured = { file: File; fps: number; frames: number; seconds: number; width: number; height: number }

const FPS_STEPS = [24, 25, 30, 48, 50, 60]

/** Capture [start, end] seconds of the video shown in `area` (the player's box on this page). */
export async function captureSegment(player: PlayerLike, area: HTMLElement, start: number, end: number,
  opts: { rate?: number; maxWidth?: number; onProgress?: (p: CaptureProgress) => void; signal?: AbortSignal } = {}): Promise<Captured> {
  const rate = opts.rate ?? 0.25
  const say = opts.onProgress ?? (() => undefined)
  if (end - start < 0.5) throw new Error('Pick a stretch at least half a second long.')
  if (end - start > 20) throw new Error('Pick at most 20 seconds: just the deliveries.')
  // 1. permission to capture this tab
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: { ideal: 60 }, displaySurface: 'browser' }, audio: false,
    preferCurrentTab: true, selfBrowserSurface: 'include', surfaceSwitching: 'exclude',
  } as DisplayMediaStreamOptions)
  const track = stream.getVideoTracks()[0]
  const stopAll = () => { track.stop(); stream.getTracks().forEach(t => t.stop()) }
  try {
    // capture exactly the player's box where the browser can (Chrome); otherwise crop by its position on the page
    let cropped = false
    const CT = (globalThis as { CropTarget?: { fromElement(e: Element): Promise<unknown> } }).CropTarget
    if (CT && 'cropTo' in track) {
      try { await (track as unknown as { cropTo(t: unknown): Promise<void> }).cropTo(await CT.fromElement(area)); cropped = true } catch { /* fall back */ }
    }
    const video = document.createElement('video')
    video.muted = true; video.playsInline = true; video.srcObject = stream
    await video.play()
    await new Promise(r => setTimeout(r, 300))
    const rect = area.getBoundingClientRect()
    const sx = video.videoWidth / window.innerWidth, sy = video.videoHeight / window.innerHeight
    const crop = cropped ? { x: 0, y: 0, w: video.videoWidth, h: video.videoHeight }
      : { x: Math.round(rect.left * sx), y: Math.round(rect.top * sy), w: Math.round(rect.width * sx), h: Math.round(rect.height * sy) }
    if (crop.w < 160 || crop.h < 90) throw new Error("The video area couldn't be found in the capture. Keep the video on screen and try again.")
    const maxW = opts.maxWidth ?? 1280
    const scale = Math.min(1, maxW / crop.w)
    const W = Math.round((crop.w * scale) / 2) * 2, H = Math.round((crop.h * scale) / 2) * 2
    const canvas = new OffscreenCanvas(W, H)
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    const sig = new OffscreenCanvas(64, 36)
    const sctx = sig.getContext('2d', { willReadFrequently: true })!

    // 2. encoder: H.264 where available, VP9 otherwise
    const chunks: { data: Uint8Array; key: boolean }[] = []
    let description: Uint8Array | undefined
    let encErr: unknown = null
    const enc = new VideoEncoder({
      output: (c, meta) => {
        const b = new Uint8Array(c.byteLength); c.copyTo(b); chunks.push({ data: b, key: c.type === 'key' })
        const d = meta?.decoderConfig?.description
        if (d && !description) description = new Uint8Array(d instanceof ArrayBuffer ? d : (d as ArrayBufferView).buffer.slice(0))
      },
      error: e => { encErr = e },
    })
    let codec = ''
    for (const c of [{ codec: 'avc1.640028', avc: { format: 'avc' } }, { codec: 'avc1.42E028', avc: { format: 'avc' } }, { codec: 'vp09.00.40.08' }]) {
      const cfg = { ...c, width: W, height: H, bitrate: 14_000_000, framerate: 60, latencyMode: 'quality' } as VideoEncoderConfig
      if ((await VideoEncoder.isConfigSupported(cfg).catch(() => ({ supported: false }))).supported) { enc.configure(cfg); codec = c.codec; break }
    }
    if (!codec) throw new Error("This browser can't encode video. Try a recent Chrome or Edge.")

    // 3. play the stretch slowly and keep each new frame once
    say({ stage: 'waiting', done: 0, total: 1 })
    player.pause(); player.setRate(rate); player.seek(Math.max(0, start - 0.3))
    await new Promise(r => setTimeout(r, 700))
    player.play()
    const arrivals: number[] = []
    let last: Uint8ClampedArray | null = null
    let started = false, done = false
    const t0 = performance.now()
    await new Promise<void>((resolve, reject) => {
      const onFrame = (now: number) => {
        if (done) return
        if (opts.signal?.aborted || encErr) { done = true; reject(encErr ?? new Error('Stopped')); return }
        const t = player.time()
        if (!started && player.playing() && t >= start) started = true
        if (started) {
          ctx.drawImage(video, crop.x, crop.y, crop.w, crop.h, 0, 0, W, H)
          sctx.drawImage(canvas, 0, 0, 64, 36)
          const px = sctx.getImageData(0, 0, 64, 36).data
          let diff = 0
          if (last) for (let i = 0; i < px.length; i += 4) diff += Math.abs(px[i + 1] - last[i + 1])
          if (!last || diff / (64 * 36) > 0.4) {
            last = px
            arrivals.push(now)
            const vf = new VideoFrame(canvas, { timestamp: Math.round((now - t0) * 1000) })
            enc.encode(vf, { keyFrame: arrivals.length % 30 === 1 }); vf.close()
          }
          say({ stage: 'capturing', done: Math.min(t, end) - start, total: end - start })
          if (t >= end) { done = true; resolve(); return }
        } else if (performance.now() - t0 > 15000) { done = true; reject(new Error("The video didn't start. If an advert is playing, wait for it to finish and try again.")); return }
        video.requestVideoFrameCallback(onFrame)
      }
      video.requestVideoFrameCallback(onFrame)
    })
    player.pause(); player.setRate(1)
    say({ stage: 'encoding', done: 0, total: 1 })
    await enc.flush(); enc.close()
    if (arrivals.length < 10 || chunks.length !== arrivals.length) throw new Error('Too few frames were captured. Keep this tab visible during the capture and try again.')

    // 4. exact frame times: the stretch played at a known slow rate, so the gaps between new frames are whole numbers
    // of the video's frame interval; find that frame rate and place every frame on its grid
    const src = arrivals.map(a => ((a - arrivals[0]) / 1000) * rate)
    const gaps = src.slice(1).map((s, i) => s - src[i]).sort((a, b) => a - b)
    const est = 1 / gaps[Math.floor(gaps.length * 0.25)]
    const fps = FPS_STEPS.reduce((b, f) => (Math.abs(f - est) < Math.abs(b - est) ? f : b), 30)
    let prev = -1
    const slots = src.map(s => { let k = Math.round(s * fps); if (k <= prev) k = prev + 1; prev = k; return k })
    const samples: Sample[] = chunks.map((c, i) => ({ data: c.data, key: c.key, timeUs: Math.round((start + slots[i] / fps) * 1e6) }))
    const mp4 = muxMp4({ codec, width: W, height: H, description }, samples)
    const file = new File([mp4], 'youtube-capture.mp4', { type: 'video/mp4' })
    return { file, fps, frames: samples.length, seconds: (slots[slots.length - 1] - slots[0]) / fps, width: W, height: H }
  } finally {
    stopAll()
  }
}
