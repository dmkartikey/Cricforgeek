import { useEffect, useMemo, useRef, useState } from 'react';
import { usePageMeta } from '../lib/meta';
import { Panel, Seg } from '../components/ui';
import { readMp4, decodeAll, procSize, webCodecsOk, Track } from '../nets/video';
import { analyse, Analysis, Progress } from '../nets/analyse';
import { CLOUD_API, analyseCloud, stillByVideo } from '../nets/cloud';
import { PITCH, CREASE, STUMP_H, STUMP_W, RETURN_Y, V3, project } from '../nets/geom';
import type { Tap } from '../nets/fit';
import type { Frame } from '../nets/detect';
import { coach, coachBatter, Hand, Kind, Insight } from '../nets/coach';

// The points the user can mark, in pitch coordinates (x along the pitch from the bowler's stumps, y to the right as
// the camera sees it, z up). Any four or more will do; points near the camera make the calibration much firmer.
type Mark = { key: string; label: string; group: string; X: V3 };
const HALF = STUMP_W / 2;
const MARKS: Mark[] = [
  { key: 'fLt', group: "Batter's end stumps", label: 'Left stump, top', X: [PITCH, -HALF, STUMP_H] },
  { key: 'fLb', group: "Batter's end stumps", label: 'Left stump, bottom', X: [PITCH, -HALF, 0] },
  { key: 'fRt', group: "Batter's end stumps", label: 'Right stump, top', X: [PITCH, HALF, STUMP_H] },
  { key: 'fRb', group: "Batter's end stumps", label: 'Right stump, bottom', X: [PITCH, HALF, 0] },
  { key: 'fPL', group: "Batter's end creases", label: 'Popping crease meets left return crease', X: [PITCH - CREASE, -RETURN_Y, 0] },
  { key: 'fPR', group: "Batter's end creases", label: 'Popping crease meets right return crease', X: [PITCH - CREASE, RETURN_Y, 0] },
  { key: 'nPL', group: "Bowler's end creases", label: 'Popping crease meets left return crease', X: [CREASE, -RETURN_Y, 0] },
  { key: 'nPR', group: "Bowler's end creases", label: 'Popping crease meets right return crease', X: [CREASE, RETURN_Y, 0] },
  { key: 'nBL', group: "Bowler's end creases", label: 'Stumps line meets left return crease', X: [0, -RETURN_Y, 0] },
  { key: 'nBR', group: "Bowler's end creases", label: 'Stumps line meets right return crease', X: [0, RETURN_Y, 0] },
  { key: 'nLt', group: "Bowler's end stumps", label: 'Left stump, top', X: [0, -HALF, STUMP_H] },
  { key: 'nLb', group: "Bowler's end stumps", label: 'Left stump, bottom', X: [0, -HALF, 0] },
  { key: 'nRt', group: "Bowler's end stumps", label: 'Right stump, top', X: [0, HALF, STUMP_H] },
  { key: 'nRb', group: "Bowler's end stumps", label: 'Right stump, bottom', X: [0, HALF, 0] },
];

type Clip = { file: File; track: Track | null; W: number; H: number; still: ImageData; fpsFile: number; frames: number; sample?: boolean; stillAt?: number };
const STILLS = [1 / 3, 0.02, 0.6, 0.85, 0.15];

export default function Nets() {
  usePageMeta('Nets analyser');
  const [clip, setClip] = useState<Clip | null>(null);
  const [taps, setTaps] = useState<Record<string, [number, number]>>({});
  const [slow, setSlow] = useState<'1' | '4' | '8'>('1');
  const [lens, setLens] = useState<'normal' | 'zoomed' | 'wide'>('normal');
  const [prog, setProg] = useState<Progress | null>(null);
  const [res, setRes] = useState<Analysis | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async (file: File, sample?: { taps: Record<string, [number, number]> }) => {
    setErr(null); setRes(null); setTaps({}); setBusy(true);
    try {
      // the frame-exact reader when the browser has it; otherwise (cloud mode) a still from a plain <video>
      const track = webCodecsOk() ? await readMp4(file).catch(() => null) : null;
      if (track) {
        const { W, H } = procSize(track.width, track.height, track.rotation);
        const n = track.times.length;
        let still: ImageData | null = null;
        await decodeAll(file, track, ({ frame }) => { still = toImage(frame); }, { from: Math.floor(n / 3), to: Math.floor(n / 3) + 1 }).catch(() => null);
        if (still) {
          setClip({ file, track, W, H, still, fpsFile: track.fpsNominal, frames: n, sample: !!sample });
          if (sample) setTaps(sample.taps);
          setBusy(false);
          return;
        }
      }
      if (!CLOUD_API) throw new Error(track ? "This browser can't decode this video. Try Chrome or Safari." : 'This browser cannot read video frame by frame. Please use a recent Chrome, Edge or Safari.');
      const s = await stillByVideo(file);
      setClip({ file, track: null, W: s.w, H: s.h, still: s.img, fpsFile: 0, frames: 0, sample: !!sample });
      if (sample) setTaps(sample.taps);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  };

  const loadSample = async () => {
    setBusy(true);
    try {
      const [v, j] = await Promise.all([fetch('/nets-assets/sample.mp4'), fetch('/nets-assets/sample.json')]);
      const blob = await v.blob(); const meta = await j.json();
      await load(new File([blob], 'sample.mp4', { type: 'video/mp4' }), meta);
    } catch { setErr('The sample could not be loaded.'); setBusy(false); }
  };

  const run = async () => {
    if (!clip) return;
    setErr(null); setRes(null); setBusy(true);
    try {
      const tapList: Tap[] = MARKS.filter(m => taps[m.key]).map(m => ({ u: taps[m.key][0], v: taps[m.key][1], X: m.X }));
      const opts = { slow: Number(slow), lens, onProgress: setProg };
      const out = CLOUD_API ? await analyseCloud(clip.file, tapList, clip.W, clip.H, opts)
        : await analyse(clip.file, clip.track!, tapList, clip.W, clip.H, opts);
      setRes(out);
      if (!out.deliveries.length) setErr('No deliveries were found in this clip. Check that the ball is visible against the background and the whole pitch is in shot.');
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setProg(null); setBusy(false);
  };

  const nTaps = Object.keys(taps).length;
  return (
    <>
      <section className="fade-in stack">
        <div className="eyebrow">Nets lab · beta</div>
        <h1>Nets analyser</h1>
        <p className="sub" style={{ maxWidth: 780 }}>
          Film the nets on your phone and get every ball's speed, length, line, swing, bounce and deviation off the pitch,
          with coaching notes on the whole spell.{' '}
          {CLOUD_API ? 'The clip is analysed on our server and deleted as soon as the analysis is done.' : 'Everything runs on your device: the video is never uploaded.'}
        </p>
      </section>

      {!clip && (
        <div className="grid g2">
          <Panel title="1. Choose a video" sub="One clip can hold several deliveries.">
            <div className="nets-pick">
              <label className="btn primary">
                <input type="file" accept="video/mp4,video/quicktime,video/*" hidden disabled={busy}
                  onChange={e => { const f = e.target.files?.[0]; if (f) load(f); }} />
                {busy ? 'Reading…' : 'Choose a video'}
              </label>
              <button type="button" className="btn" onClick={loadSample} disabled={busy}>Try a sample clip</button>
            </div>
          </Panel>
          <Panel title="How to film" sub="A steady phone and a clear view are what make the numbers accurate.">
            <ul className="nets-tips">
              <li><b>On a tripod</b> (or wedged still) behind the bowler's arm, 1.5–2 m high, aimed down the pitch. Landscape.</li>
              <li><b>Both ends in shot:</b> the far stumps and, ideally, the creases at your end too.</li>
              <li><b>Highest frame rate you have.</b> 60 fps is good; slow motion (120 or 240 fps) is best.</li>
              <li><b>Good light,</b> and a ball that stands out from the net behind it.</li>
            </ul>
          </Panel>
        </div>
      )}

      {err && <div className="panel nets-err" role="alert">{err}</div>}

      {clip && !res && (
        <div className="grid nets-grid">
          <Panel title="2. Mark the pitch" sub="Tap near a point to zoom in, then tap exactly on it. Mark at least four; the more spread out, the better."
            right={<span className="nets-actions">
              <button type="button" className="btn small" onClick={async () => {
                const k = ((clip.stillAt ?? 0) + 1) % STILLS.length;
                let still: ImageData | null = null;
                if (clip.track) {
                  const n = clip.track.times.length, at = Math.min(n - 1, Math.floor(n * STILLS[k]));
                  await decodeAll(clip.file, clip.track, ({ frame }) => { still = toImage(frame); }, { from: at, to: at + 1 });
                } else still = (await stillByVideo(clip.file, STILLS[k])).img;
                if (still) setClip({ ...clip, still, stillAt: k });
              }}>Show another frame</button>
              <button type="button" className="btn small" onClick={() => { setClip(null); setTaps({}); }}>Change video</button></span>}>
            <TapCanvas clip={clip} taps={taps} setTaps={setTaps} />
          </Panel>
          <Panel title="3. Analyse" sub={clip.track ? `${clip.W}×${clip.H}, ${Math.round(clip.fpsFile)} fps, ${clip.frames} frames.` : `${clip.W}×${clip.H}.`}>
            <div className="stack">
              <Seg label="Speed of the file" value={slow} onChange={setSlow}
                options={[['1', 'Plays at real speed'], ['4', 'Slow motion ×4'], ['8', 'Slow motion ×8']]} />
              <small className="muted">Slow-motion clips saved from a phone often play slower than real life. If the bowler looks slow, pick how many times slower (a 240 fps clip played at 30 fps is ×8).</small>
              <Seg label="Camera lens" value={lens} onChange={setLens}
                options={[['normal', 'Normal (1×)'], ['zoomed', 'Zoomed in'], ['wide', 'Ultra-wide (0.5×)']]} />
              <small className="muted">Knowing the lens makes the measurements firmer, especially when only the far end is marked.</small>
              <button type="button" className="btn primary" disabled={busy || nTaps < 4} onClick={run}>
                {busy ? 'Working…' : nTaps < 4 ? `Mark ${4 - nTaps} more point${4 - nTaps > 1 ? 's' : ''}` : 'Analyse the clip'}
              </button>
              {prog && <ProgressBar p={prog} />}
            </div>
          </Panel>
        </div>
      )}

      {clip && res && <Results clip={clip} res={res} onBack={() => setRes(null)} />}
    </>
  );
}

function toImage(f: Frame): ImageData {
  const img = new ImageData(f.w, f.h);
  for (let i = 0, j = 0; j < f.d.length; i += 4, j += 3) { img.data[i] = f.d[j + 2]; img.data[i + 1] = f.d[j + 1]; img.data[i + 2] = f.d[j]; img.data[i + 3] = 255; }
  return img;
}

const STAGES: Record<string, string> = { uploading: 'Uploading the clip', loading: 'Loading the ball model', finding: 'Finding the ball in every frame', tracking: 'Following each delivery', measuring: 'Measuring each ball' };
function ProgressBar({ p }: { p: Progress }) {
  const f = p.total ? Math.min(1, p.done / p.total) : 0;
  return (
    <div className="nets-prog" role="status" aria-live="polite">
      <div className="nets-prog-bar"><i style={{ width: `${Math.round(f * 100)}%` }} /></div>
      <small>{STAGES[p.stage]}{p.total > 1 ? ` · ${Math.round(f * 100)}%` : '…'}</small>
    </div>
  );
}

// ---------------------------------------------------------------- tapping the pitch marks
function TapCanvas({ clip, taps, setTaps }: { clip: Clip; taps: Record<string, [number, number]>; setTaps: (t: Record<string, [number, number]>) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [zoom, setZoom] = useState<[number, number] | null>(null);
  const firstOpen = MARKS.find(m => !taps[m.key])?.key ?? MARKS[0].key;
  const [active, setActive] = useState<string>(firstOpen);
  const Z = 4;
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const ctx = c.getContext('2d')!;
    const src = document.createElement('canvas'); src.width = clip.W; src.height = clip.H;
    src.getContext('2d')!.putImageData(clip.still, 0, 0);
    ctx.imageSmoothingEnabled = !zoom;
    if (zoom) {
      const w = clip.W / Z, h = clip.H / Z;
      ctx.drawImage(src, zoom[0] - w / 2, zoom[1] - h / 2, w, h, 0, 0, clip.W, clip.H);
    } else ctx.drawImage(src, 0, 0);
    for (const m of MARKS) {
      const t = taps[m.key]; if (!t) continue;
      const [x, y] = zoom ? [(t[0] - zoom[0]) * Z + clip.W / 2, (t[1] - zoom[1]) * Z + clip.H / 2] : t;
      ctx.strokeStyle = m.key === active ? '#ffd23f' : '#3fd28b'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x - 8, y); ctx.lineTo(x + 8, y); ctx.moveTo(x, y - 8); ctx.lineTo(x, y + 8); ctx.stroke();
    }
  }, [clip, taps, zoom, active]);
  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const c = ref.current!; const r = c.getBoundingClientRect();
    const x = (e.clientX - r.left) * clip.W / r.width, y = (e.clientY - r.top) * clip.H / r.height;
    if (!zoom) { setZoom([x, y]); return; }
    const u = zoom[0] + (x - clip.W / 2) / Z, v = zoom[1] + (y - clip.H / 2) / Z;
    const next = { ...taps, [active]: [u, v] as [number, number] };
    setTaps(next); setZoom(null);
    const nxt = MARKS.find(m => !next[m.key]);
    if (nxt) setActive(nxt.key);
  };
  const groups = [...new Set(MARKS.map(m => m.group))];
  return (
    <div className="stack">
      <div className="nets-now">Marking: <b>{MARKS.find(m => m.key === active)?.group} — {MARKS.find(m => m.key === active)?.label}</b>{zoom && <button type="button" className="btn small" onClick={() => setZoom(null)}>Zoom out</button>}</div>
      <canvas ref={ref} width={clip.W} height={clip.H} className="nets-canvas" onClick={onClick} aria-label="Video frame: tap to mark the selected point" />
      <div className="nets-marks">
        {groups.map(g => (
          <div key={g}>
            <small className="muted">{g}</small>
            <div className="nets-chips">
              {MARKS.filter(m => m.group === g).map(m => (
                <button key={m.key} type="button" className={`nets-chip ${m.key === active ? 'on' : ''} ${taps[m.key] ? 'done' : ''}`} aria-pressed={m.key === active}
                  onClick={() => setActive(m.key)}>{taps[m.key] ? '✓ ' : ''}{m.label}</button>
              ))}
            </div>
          </div>
        ))}
        {Object.keys(taps).length > 0 && <button type="button" className="btn small" onClick={() => { const t = { ...taps }; delete t[active]; setTaps(t); }}>Clear this point</button>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- results
const fmt1 = (x?: number) => x === undefined || !isFinite(x) ? '–' : x.toFixed(1);
function lengthName(m?: number) {
  if (m === undefined) return 'Full toss';
  if (m < 2) return 'Yorker';
  if (m < 4) return 'Full';
  if (m < 6) return 'Good length';
  if (m < 8) return 'Back of a length';
  return 'Short';
}
function lineName(y?: number) {
  if (y === undefined) return '–';
  const a = Math.abs(y);
  if (a <= HALF + 0.036) return 'Hitting the stumps';
  return `${(100 * (a - HALF)).toFixed(0)} cm ${y < 0 ? 'left' : 'right'} of the stumps`;
}

function Results({ clip, res, onBack }: { clip: Clip; res: Analysis; onBack: () => void }) {
  const ok = res.deliveries.filter(d => d.result);
  const [sel, setSel] = useState(0);
  const csv = useMemo(() => {
    const rows = [['ball', 'time_s', 'speed_kmh', 'speed_pm_kmh', 'length_m', 'line_at_stumps_cm', 'height_at_stumps_cm', 'swing_cm', 'deviation_deg', 'bounce_speed_kmh']];
    ok.forEach((d, i) => { const r = d.result!; rows.push([String(i + 1), d.tStart.toFixed(2), fmt1(r.speedKmh), fmt1(r.speedSd), r.lengthM?.toFixed(2) ?? '', r.lineY !== undefined ? (100 * r.lineY).toFixed(0) : '', r.heightZ !== undefined ? (100 * r.heightZ).toFixed(0) : '', r.swingM !== undefined ? (100 * r.swingM).toFixed(0) : '', r.lengthM !== undefined ? r.devDeg.toFixed(1) : '', fmt1(r.speedBounceKmh)]); });
    return rows.map(r => r.join(',')).join('\n');
  }, [ok]);
  const download = () => {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'nets-session.csv'; a.click();
  };
  const sp = ok.map(d => d.result!.speedKmh);
  return (
    <>
      <div className="grid g4 nets-kpis">
        <Kpi label="Deliveries measured" value={`${ok.length}`} />
        <Kpi label="Fastest" value={sp.length ? `${Math.max(...sp).toFixed(1)} km/h` : '–'} />
        <Kpi label="Average speed" value={sp.length ? `${(sp.reduce((a, b) => a + b, 0) / sp.length).toFixed(1)} km/h` : '–'} />
        <Kpi label="Calibration fit" value={`${res.calibRms.toFixed(1)} px`} hint={res.calibRms > 4 ? 'Check the marked points' : 'Good'} />
      </div>
      <CoachPanel res={res} />
      <div className="grid g2">
        <Panel title="Pitch map" sub="Where each ball landed, seen from above. Stumps at the top.">
          <PitchMap res={res} sel={sel} onSel={setSel} />
        </Panel>
        <Panel title="At the stumps" sub="Where each ball passed the batter's stumps, as the camera sees it.">
          <Beehive res={res} sel={sel} onSel={setSel} />
        </Panel>
      </div>
      <Panel title="Ball by ball" sub="± is the measurement's own uncertainty: how tightly the video pins the number down."
        right={<span className="nets-actions"><button type="button" className="btn small" onClick={download}>Download CSV</button><button type="button" className="btn small" onClick={onBack}>Back</button></span>}>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>#</th><th>Speed</th><th>Length</th><th>Line at stumps</th><th>Height at stumps</th><th>Swing</th><th>Off the pitch</th>{ok.some(d => d.shot) && <th>Batter</th>}</tr></thead>
            <tbody>
              {ok.map((d, i) => { const r = d.result!; return (
                <tr key={i} className={i === sel ? 'sel' : ''} onClick={() => setSel(i)}>
                  <td>{i + 1}</td>
                  <td><b>{fmt1(r.speedKmh)}</b> km/h{r.speedSd ? <small className="muted"> ±{fmt1(r.speedSd)}</small> : null}</td>
                  <td>{r.lengthM !== undefined ? `${r.lengthM.toFixed(1)} m · ${lengthName(r.lengthM)}` : 'Full toss'}</td>
                  <td>{lineName(r.lineY)}</td>
                  <td>{r.heightZ !== undefined ? `${(100 * r.heightZ).toFixed(0)} cm` : '–'}</td>
                  <td>{r.swingM !== undefined ? `${Math.abs(100 * r.swingM).toFixed(0)} cm ${r.swingM < 0 ? 'left' : 'right'}` : '–'}</td>
                  <td>{r.lengthM !== undefined ? `${Math.abs(r.devDeg).toFixed(1)}° ${r.devDeg < 0 ? 'left' : 'right'}` : '–'}</td>
                  {ok.some(x => x.shot) && <td>{shotText(d.shot)}</td>}
                </tr>); })}
            </tbody>
          </table>
        </div>
      </Panel>
      {ok[sel] && <Panel title={`Ball ${sel + 1} on the video`} sub="The fitted flight drawn over the frame, with the frames where the ball was seen.">
        <Overlay clip={clip} res={res} i={sel} />
      </Panel>}
    </>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return <div className="panel kpi"><small className="muted">{label}</small><div className="kpi-v">{value}</div>{hint && <small className="muted">{hint}</small>}</div>;
}

function PitchMap({ res, sel, onSel }: { res: Analysis; sel: number; onSel: (i: number) => void }) {
  // top view: 3.05 m wide strip, from 12 m out to just past the stumps; y right, x towards the top
  const W = 240, H = 420, sx = W / 3.6, top = 0.8, len = 12.5, sy = H / len;
  const X = (y: number) => W / 2 + y * sx, Y = (l: number) => top * sy + l * sy;
  const ok = res.deliveries.filter(d => d.result);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="nets-svg" role="img" aria-label="Pitch map">
      <rect x={X(-1.525)} y={0} width={3.05 * sx} height={H} fill="var(--pitch, #c9b48a)" opacity=".35" rx="4" />
      {[2, 4, 6, 8].map(l => <g key={l}><line x1={X(-1.525)} x2={X(1.525)} y1={Y(l)} y2={Y(l)} stroke="currentColor" opacity=".18" strokeDasharray="3 4" /><text x={X(1.6)} y={Y(l) + 4} fontSize="10" fill="currentColor" opacity=".55">{l} m</text></g>)}
      <line x1={X(-1.32)} x2={X(1.32)} y1={Y(CREASE)} y2={Y(CREASE)} stroke="currentColor" opacity=".6" />
      <rect x={X(-HALF)} y={Y(0) - 3} width={STUMP_W * sx} height={6} fill="currentColor" />
      {ok.map((d, i) => d.result!.lengthM !== undefined && (
        <circle key={i} cx={X(d.result!.bounceY!)} cy={Y(d.result!.lengthM!)} r={i === sel ? 7 : 5} fill={i === sel ? 'var(--red)' : 'var(--s1)'} stroke="#fff" strokeWidth="1.2" onClick={() => onSel(i)} style={{ cursor: 'pointer' }}>
          <title>{`Ball ${i + 1}: ${d.result!.lengthM!.toFixed(1)} m, ${d.result!.speedKmh.toFixed(1)} km/h`}</title>
        </circle>))}
    </svg>
  );
}

function Beehive({ res, sel, onSel }: { res: Analysis; sel: number; onSel: (i: number) => void }) {
  const W = 300, H = 260, s = 110, base = H - 20;
  const X = (y: number) => W / 2 + y * s, Y = (z: number) => base - z * s;
  const ok = res.deliveries.filter(d => d.result);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="nets-svg" role="img" aria-label="Where each ball passed the stumps">
      <line x1={0} x2={W} y1={base} y2={base} stroke="currentColor" opacity=".4" />
      {[-HALF + 0.018, 0, HALF - 0.018].map(y => <rect key={y} x={X(y) - 2} y={Y(STUMP_H)} width={4} height={STUMP_H * s} fill="currentColor" opacity=".75" />)}
      {ok.map((d, i) => d.result!.lineY !== undefined && (
        <circle key={i} cx={X(d.result!.lineY!)} cy={Y(d.result!.heightZ!)} r={i === sel ? 7 : 5} fill={i === sel ? 'var(--red)' : 'var(--s1)'} stroke="#fff" strokeWidth="1.2" onClick={() => onSel(i)} style={{ cursor: 'pointer' }}>
          <title>{`Ball ${i + 1}: ${(100 * d.result!.heightZ!).toFixed(0)} cm high`}</title>
        </circle>))}
    </svg>
  );
}

function Overlay({ clip, res, i }: { clip: Clip; res: Analysis; i: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const ctx = c.getContext('2d')!;
    ctx.putImageData(clip.still, 0, 0);
    const d = res.deliveries.filter(x => x.result)[i];
    const path = d.result!.path ?? [];
    ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 2.5; ctx.beginPath();
    path.forEach((P, k) => { const [u, v, z] = project(res.cam, P); if (z > 0.3) { if (k) ctx.lineTo(u, v); else ctx.moveTo(u, v); } });
    ctx.stroke();
    ctx.fillStyle = '#ff4d4d';
    for (const o of d.obs) { ctx.beginPath(); ctx.arc(o.u, o.v, 2.2, 0, 2 * Math.PI); ctx.fill(); }
  }, [clip, res, i]);
  return <canvas ref={ref} width={clip.W} height={clip.H} className="nets-canvas" aria-label="Fitted flight over the video frame" />;
}

function shotText(s?: import('../nets/coach').Shot) {
  if (!s) return '–';
  const o: Record<string, string> = { attacking: 'Hit', defended: 'Defended', edged: 'Edged', 'not hit': 'Left / missed', left: 'Left', missed: 'Missed', bowled: 'Bowled', unclear: '–' };
  return s.exitKmh && s.outcome === 'attacking' ? `${o[s.outcome]} ${s.exitKmh.toFixed(0)} km/h${s.inAir ? ', in the air' : ''}` : o[s.outcome] ?? s.outcome;
}

// ---------------------------------------------------------------- the coach
function CoachPanel({ res }: { res: Analysis }) {
  const [role, setRole] = useState<'bowler' | 'batter'>('bowler');
  const [hand, setHand] = useState<Hand>('R');
  const [kindSel, setKindSel] = useState<'auto' | Kind>('auto');
  const ok = res.deliveries.filter(d => d.result);
  const kind = kindSel === 'auto' ? undefined : kindSel;
  const bowl = useMemo(() => coach(ok.map(d => d.result!), hand, kind), [res, hand, kindSel]);
  const bat = useMemo(() => coachBatter(ok.map(d => ({ result: d.result!, shot: d.shot })), hand, kind), [res, hand, kindSel]);
  const hasShots = ok.some(d => d.shot);
  const rep = role === 'bowler' ? bowl : bat;
  return (
    <Panel title="Coach" eyebrow={role === 'bowler' ? 'For the bowler' : 'For the batter'}
      sub={role === 'bowler' ? `Read as a ${bowl.kind === 'pace' ? 'pace' : 'spin'} bowler${bowl.kindAuto ? ' (from the speeds)' : ''}, bowling to a ${hand === 'R' ? 'right' : 'left'}-handed batter.` : `For a ${hand === 'R' ? 'right' : 'left'}-handed batter.`}
      tools={<span className="nets-coach-tools">
        <Seg label="Coach" value={role} onChange={setRole} options={[['bowler', 'Bowler'], ['batter', 'Batter']]} />
        <Seg label="Batter" value={hand} onChange={setHand} options={[['R', 'Right-hander'], ['L', 'Left-hander']]} />
        <Seg label="Bowling" value={kindSel} onChange={setKindSel} options={[['auto', 'Auto'], ['pace', 'Pace'], ['spin', 'Spin']]} />
      </span>}>
      <div className="nets-coach">
        {(role === 'bowler' || hasShots) && <div className="nets-score"><b>{rep.score}</b><small>/ 100</small></div>}
        <div><h3>{rep.headline}</h3>
          {role === 'batter' && !hasShots && <p className="muted">Shot details (played, left, edged, how hard and where) come with the cloud analysis. Below is what you faced.</p>}
          {role === 'bowler' && bowl.best && <p>Best ball: <b>ball {bowl.best.index + 1}</b>, {bowl.best.why}</p>}
        </div>
      </div>
      {rep.focus.length > 0 && <div className="nets-focus"><h4>Focus for next session</h4>{rep.focus.map((f, i) => <Note key={i} f={f} n={i + 1} />)}</div>}
      <div className="nets-notes">{rep.insights.filter(i => !rep.focus.includes(i)).map((f, i) => <Note key={i} f={f} />)}</div>
      {role === 'bowler' && <div className="nets-zones">{bowl.zones.map(z => <span key={z.name} className={z.target ? 'on' : ''}>{z.name} <b>{z.count}</b></span>)}</div>}
      {role === 'batter' && hasShots && <div className="grid g2"><Grid rep={bat} hand={hand} /><Wagon rep={bat} hand={hand} /></div>}
    </Panel>
  );
}

function Note({ f, n }: { f: Insight; n?: number }) {
  return (
    <div className={`nets-note ${f.tone}`}>
      <div className="nets-note-h">{n ? <span className="nets-n">{n}</span> : <span className="nets-tag">{f.area}</span>}<b>{f.title}</b></div>
      <p>{f.detail}</p>
      {f.drill && <p className="nets-drill"><span>Drill</span>{f.drill}</p>}
    </div>
  );
}

function Grid({ rep, hand }: { rep: ReturnType<typeof coachBatter>; hand: Hand }) {
  const lines = hand === 'R' ? ['Leg', 'Stumps', 'Off'] : ['Off', 'Stumps', 'Leg']; // as the camera sees it
  return (
    <div><small className="muted">Balls faced and hit hard, by length and line (as seen from the bowler's end)</small>
      <table className="table nets-grid3"><thead><tr><th></th>{lines.map(l => <th key={l}>{l}</th>)}</tr></thead>
        <tbody>{['Full', 'Good', 'Short'].map(len => <tr key={len}><th>{len}</th>{lines.map(line => {
          const c = rep.grid.find(g => g.len === len && g.line === line)!;
          return <td key={line} style={{ background: c.balls ? `color-mix(in srgb, var(--s1) ${Math.round(100 * c.hit / c.balls) * 0.6}%, transparent)` : undefined }}>
            {c.balls ? <>{c.hit}/{c.balls}{c.avgExit ? <small> · {c.avgExit.toFixed(0)} km/h</small> : null}</> : '–'}</td>;
        })}</tr>)}</tbody></table></div>
  );
}

function Wagon({ rep, hand }: { rep: ReturnType<typeof coachBatter>; hand: Hand }) {
  // seen from above with the batter at the centre and the bowler at the bottom; the off side on the batter's side
  const R = 110, c = 130;
  return (
    <div><small className="muted">Where the attacking shots went (longer = harder)</small>
      <svg viewBox="0 0 260 260" className="nets-svg" role="img" aria-label="Wagon wheel">
        <circle cx={c} cy={c} r={R} fill="var(--s1)" opacity=".08" stroke="currentColor" strokeOpacity=".2" />
        <line x1={c} y1={c - R} x2={c} y2={c + R} stroke="currentColor" opacity=".15" />
        <text x={c} y={c + R + 14} fontSize="10" textAnchor="middle" fill="currentColor" opacity=".6">bowler</text>
        <text x={hand === 'R' ? c + R - 6 : c - R + 6} y={c - R + 12} fontSize="10" textAnchor={hand === 'R' ? 'end' : 'start'} fill="currentColor" opacity=".6">off side</text>
        <text x={hand === 'R' ? c - R + 6 : c + R - 6} y={c - R + 12} fontSize="10" textAnchor={hand === 'R' ? 'start' : 'end'} fill="currentColor" opacity=".6">leg side</text>
        {rep.shots.map(s => {
          const a = (s.az * Math.PI) / 180, L = Math.min(1, s.kmh / 120) * R;
          // azimuth 0 = back past the bowler (down the page); +90 = the bowler's right (the page's right)
          return <line key={s.i} x1={c} y1={c} x2={c + L * Math.sin(a)} y2={c + L * Math.cos(a)} stroke={s.air ? 'var(--red)' : 'var(--s1)'} strokeWidth="2.5" strokeLinecap="round"><title>{`Ball ${s.i + 1}: ${s.kmh.toFixed(0)} km/h${s.air ? ', in the air' : ''}`}</title></line>;
        })}
      </svg></div>
  );
}
