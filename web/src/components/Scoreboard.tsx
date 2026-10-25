import { ReactNode, useEffect, useRef, useState } from 'react';

// A painted cricket scoreboard with split-flap number tiles.
// Digits clatter through a few random numbers before landing, like a mechanical board.

const reduced = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const PAINTED = new Set(['.', ',', '%', '/', '·', ' ', '(', ')', '×']);
const isDigit = (c: string) => c >= '0' && c <= '9';

function FlapChar({ ch, delay }: { ch: string; delay: number }) {
  const still = reduced();
  const [cur, setCur] = useState(still ? ch : isDigit(ch) ? '0' : ch);
  const [prev, setPrev] = useState(cur);
  const [tick, setTick] = useState(0);
  const curRef = useRef(cur);
  useEffect(() => {
    if (still) { setCur(ch); setPrev(ch); curRef.current = ch; return; }
    const seq: string[] = [];
    if (isDigit(ch)) {
      const n = 3 + Math.floor(Math.random() * 4);
      for (let i = 0; i < n; i++) seq.push(String(Math.floor(Math.random() * 10)));
    }
    seq.push(ch);
    let i = 0;
    let t: ReturnType<typeof setTimeout>;
    const step = () => {
      const next = seq[i++];
      setPrev(curRef.current);
      setCur(next);
      curRef.current = next;
      setTick((k) => k + 1);
      if (i < seq.length) t = setTimeout(step, 95);
    };
    t = setTimeout(step, delay);
    return () => clearTimeout(t);
  }, [ch]); // eslint-disable-line
  return (
    <span className="ft" aria-hidden="true">
      <span className="ft-h ft-top">{cur}</span>
      <span className="ft-h ft-bot">{prev}</span>
      {tick > 0 && <span key={'a' + tick} className="ft-h ft-top ft-fold">{prev}</span>}
      {tick > 0 && <span key={'b' + tick} className="ft-h ft-bot ft-drop">{cur}</span>}
    </span>
  );
}

export function Flap({ text, delay = 0, size }: { text: string; delay?: number; size?: number }) {
  let n = 0;
  return (
    <span className="flapnum" aria-label={text} role="img" style={size ? { fontSize: size } : undefined}>
      {text.split('').map((c, i) => (PAINTED.has(c)
        ? <span key={i} className="fp" aria-hidden="true">{c}</span>
        : <FlapChar key={i} ch={c} delay={delay + (n++) * 70} />))}
    </span>
  );
}

export function Board({ plate, children, className = '', foot }: { plate?: ReactNode; children: ReactNode; className?: string; foot?: ReactNode }) {
  return (
    <section className={`sboard fade-in ${className}`}>
      <span className="bolt tl" /><span className="bolt tr" /><span className="bolt bl" /><span className="bolt br" />
      {plate && <div className="sb-plate"><span>{plate}</span></div>}
      {children}
      {foot && <div className="sb-foot">{foot}</div>}
    </section>
  );
}

export function SbCell({ label, value, sub, tone, delay = 0, big }: {
  label: ReactNode; value: string; sub?: ReactNode; tone?: 'up' | 'down' | 'flat'; delay?: number; big?: boolean;
}) {
  return (
    <div className={`sb-cell ${big ? 'big' : ''}`}>
      <span className="sb-label">{label}</span>
      <Flap text={value} delay={delay} />
      {sub && <span className={`sb-sub ${tone ?? ''}`}>{sub}</span>}
    </div>
  );
}
