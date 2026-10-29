import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useData, photoUrl } from '../lib/data';
import { usePageMeta } from '../lib/meta';
import { initials } from '../lib/fmt';
import { Loader, Seg } from '../components/ui';

// deck/{fmt}-{gender}.json rows, internationals only, full-member players:
// [id, name, team, matches, first, last, runs, bat avg, SR, 100s, 50s, 6s, HS, wkts, econ, bowl avg, best, 5w, impact]
type Card = [string, string, string, number, number, number, number, number | null, number | null, number, number, number, number, number, number | null, number | null, string | null, number, number];
type Stat = { k: number; l: string; low?: boolean; f?: (v: number) => string };
const STATS: Stat[] = [
  { k: 3, l: 'Matches' }, { k: 6, l: 'Runs' }, { k: 7, l: 'Batting average', f: (v) => v.toFixed(1) }, { k: 8, l: 'Strike rate', f: (v) => v.toFixed(1) },
  { k: 9, l: 'Hundreds' }, { k: 11, l: 'Sixes' }, { k: 13, l: 'Wickets' }, { k: 14, l: 'Economy', low: true, f: (v) => v.toFixed(2) },
  { k: 15, l: 'Bowling average', low: true, f: (v) => v.toFixed(1) }, { k: 18, l: 'Impact', f: (v) => (v > 0 ? '+' : '') + v },
];
const HAND = 10;

function shuffle<T>(a: T[]) { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; }
const val = (c: Card, s: Stat) => c[s.k] as number | null;
/** 1 if a beats b on this stat, -1 if b wins, 0 for a draw. A missing value loses to any value. */
function cmp(a: Card, b: Card, s: Stat) {
  const x = val(a, s), y = val(b, s);
  if (x == null && y == null) return 0;
  if (x == null) return -1;
  if (y == null) return 1;
  if (x === y) return 0;
  return (s.low ? x < y : x > y) ? 1 : -1;
}

function GameCard({ c, photo, hidden, pick, chosen, result, fmt }: { c: Card; photo?: boolean; hidden?: boolean; pick?: (s: Stat) => void; chosen?: Stat | null; result?: number; fmt: string }) {
  if (hidden) return <div className="gcard back" aria-label="Opponent's card, face down"><span className="gc-ball" /><b>cricforgeek</b></div>;
  return (
    <div className={`gcard${result === 1 ? ' won' : result === -1 ? ' lost' : ''}`}>
      <div className="gc-top">
        <div className="gc-photo">{photo ? <img src={photoUrl(c[0])} alt="" /> : <span>{initials(c[1])}</span>}</div>
        <div className="gc-id"><b>{c[1]}</b><span>{c[2]} · {fmt} · {c[4]}–{c[5]}</span></div>
      </div>
      <div className="gc-stats">
        {STATS.map((s) => {
          const v = val(c, s);
          return (
            <button key={s.k} type="button" disabled={!pick} onClick={() => pick?.(s)} className={chosen?.k === s.k ? 'on' : ''}>
              <span>{s.l}{s.low ? <><small className="lw"> lower wins</small><small className="lw-i" title="Lower wins"> ↓</small></> : null}</span><b>{v == null ? '–' : s.f ? s.f(v) : v.toLocaleString('en-IN')}</b>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function Play() {
  usePageMeta('Cricket card battle');
  const [fmt, setFmt] = useState<'T20' | 'ODI' | 'TEST'>('ODI');
  const [g, setG] = useState<'male' | 'female'>('male');
  const { data: deck } = useData<Card[]>(`deck/${fmt}-${g}.json`);
  const photos = useData<Record<string, string>>('photos/index.json').data ?? {};
  const [mine, setMine] = useState<Card[]>([]), [cpu, setCpu] = useState<Card[]>([]), [pot, setPot] = useState<Card[]>([]);
  const [turn, setTurn] = useState<'me' | 'cpu'>('me');
  const [round, setRound] = useState<{ s: Stat; r: number; a: Card; b: Card; by: 'me' | 'cpu' } | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [rounds, setRounds] = useState(0);
  const fmtLabel = fmt === 'TEST' ? 'Tests' : fmt === 'ODI' ? 'ODIs' : 'T20Is';

  // percentile of each stat within the deck, so the computer picks its card's strongest stat
  const rank = useMemo(() => {
    const m = new Map<number, number[]>();
    for (const s of STATS) m.set(s.k, (deck ?? []).map((c) => val(c, s)).filter((v): v is number => v != null).sort((a, b) => a - b));
    return (c: Card, s: Stat) => { const v = val(c, s); const arr = m.get(s.k)!; if (v == null || !arr.length) return 0; const i = arr.findIndex((x) => x >= v); const p = (i < 0 ? arr.length : i) / arr.length; return s.low ? 1 - p : p; };
  }, [deck]);

  const deal = () => {
    if (!deck?.length) return;
    // well-known players first: the most-capped 160, with photos preferred
    const pool = [...deck].sort((a, b) => (photos[b[0]] ? 1 : 0) - (photos[a[0]] ? 1 : 0) || b[3] - a[3]).slice(0, 160);
    const cards = shuffle(pool).slice(0, HAND * 2);
    setMine(cards.slice(0, HAND)); setCpu(cards.slice(HAND)); setPot([]); setTurn('me'); setRound(null); setLog([]); setRounds(0);
  };
  useEffect(deal, [deck]); // eslint-disable-line

  const play = (s: Stat, by: 'me' | 'cpu' = 'me') => {
    if (round || !mine.length || !cpu.length) return;
    const a = mine[0], b = cpu[0], r = cmp(a, b, s);
    setRound({ s, r, a, b, by });
    setLog((l) => [`${s.l}: ${a[1]} ${val(a, s) ?? '–'} v ${b[1]} ${val(b, s) ?? '–'} → ${r > 0 ? 'you win' : r < 0 ? 'computer wins' : 'draw'}`, ...l].slice(0, 6));
  };
  const next = () => {
    if (!round) return;
    const { r, a, b } = round;
    const restM = mine.slice(1), restC = cpu.slice(1);
    if (r > 0) { setMine([...restM, a, b, ...pot]); setCpu(restC); setPot([]); setTurn('me'); }
    else if (r < 0) { setCpu([...restC, b, a, ...pot]); setMine(restM); setPot([]); setTurn('cpu'); }
    else { setMine(restM); setCpu(restC); setPot([...pot, a, b]); }
    setRound(null); setRounds((n) => n + 1);
  };
  // The winner of a round picks the next stat. On the computer's turn it waits for you to tap, then picks
  // its own card's strongest stat and says which one, so it never looks as if your card picked itself.
  const cpuPick = () => { const c = cpu[0]; play(STATS.reduce((best, s) => (rank(c, s) > rank(c, best) ? s : best), STATS[0]), 'cpu'); };

  const over = mine.length === 0 || cpu.length === 0 || rounds >= 30;
  if (!deck) return <Loader text="Shuffling the deck" />;
  return (
    <>
      <section className="phead fade-in">
        <div className="stack">
          <div className="eyebrow">Card battle</div>
          <h1>Card battle</h1>
          <p className="lede">Pick a stat on your top card. Higher wins, except economy and bowling average, where lower wins. Win the round and you take both cards. Take the whole deck, or hold the most after 30 rounds, to win. Every number is from official Tests, ODIs and T20Is with ball-by-ball records.</p>
        </div>
        <div className="row">
          <Seg label="Format" value={fmt} onChange={setFmt} options={[['TEST', 'Tests'], ['ODI', 'ODIs'], ['T20', 'T20Is']]} />
          <Seg label="Cricket" value={g} onChange={setG} options={[['male', 'Men'], ['female', 'Women']]} />
          <button type="button" className="btn" onClick={deal}>New game</button>
        </div>
      </section>
      <div className="game-score">
        <span>You <b>{mine.length}</b></span><span className="muted">Round {Math.min(rounds + 1, 30)} of 30{pot.length ? ` · ${pot.length} cards in the pot` : ''}</span><span>Computer <b>{cpu.length}</b></span>
      </div>
      {over ? (
        <div className="game-over fade-in">
          <h2>{mine.length > cpu.length ? 'You win!' : mine.length < cpu.length ? 'The computer wins' : 'A tie'}</h2>
          <p>{mine.length} cards to {cpu.length}.</p>
          <button type="button" className="btn primary" onClick={deal}>Play again</button>
        </div>
      ) : (
        <div className="game-table">
          <div className="stack gt-mine" style={{ gap: 8 }}>
            <span className="eyebrow">Your card {turn === 'me' && !round ? '· your pick' : turn === 'cpu' && !round ? "· computer's turn" : ''}</span>
            <GameCard c={mine[0]} photo={!!photos[mine[0][0]]} fmt={fmtLabel} pick={turn === 'me' && !round ? play : undefined} chosen={round?.s} result={round?.r} />
            <Link className="link" to={`/player/${mine[0][0]}`} style={{ fontSize: 12 }}>Full profile</Link>
          </div>
          <div className="game-mid gt-mid">
            {round ? <>
              <span className="gm-pick">{round.by === 'cpu' ? 'The computer picked' : 'You picked'} <b>{round.s.l}</b></span>
              <b className={round.r > 0 ? 'pos' : round.r < 0 ? 'neg' : ''}>{round.r > 0 ? 'You win the round' : round.r < 0 ? 'Computer wins the round' : 'Draw: both cards go in the pot'}</b>
              <button type="button" className="btn primary" onClick={next}>Next card</button>
            </> : turn === 'me' ? <span className="muted">Your turn: pick a stat on your card</span> : <>
              <span className="muted">The computer won the last round, so it picks the stat</span>
              <button type="button" className="btn primary" onClick={cpuPick}>Let the computer pick</button>
            </>}
          </div>
          <div className="stack gt-cpu" style={{ gap: 8 }}>
            <span className="eyebrow">Computer's card</span>
            <GameCard c={cpu[0]} photo={!!photos[cpu[0][0]]} fmt={fmtLabel} hidden={!round} chosen={round?.s} result={round ? -round.r : undefined} />
          </div>
        </div>
      )}
      {log.length > 0 && <div className="game-log">{log.map((l, i) => <div key={i}>{l}</div>)}</div>}
    </>
  );
}
