import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useData } from '../lib/data';
import { n0 } from '../lib/fmt';
import { TIER } from '../lib/labels';
import { Chips, ErrorBox, Loader, Panel } from '../components/ui';

export default function Leagues() {
  const { data, error } = useData<any[]>('comps/index.json');
  const [tier, setTier] = useState('all');
  const [g, setG] = useState('all');
  const groups = useMemo(() => {
    const out = new Map<string, any[]>();
    for (const c of data ?? []) {
      if (tier !== 'all' && c.tier !== tier) continue;
      if (g !== 'all' && c.gender !== g) continue;
      if (c.matches < 5) continue;
      const k = c.country;
      out.set(k, [...(out.get(k) ?? []), c]);
    }
    return [...out.entries()].sort((a, b) => (a[0] === 'International' ? -1 : b[0] === 'International' ? 1 : b[1].length - a[1].length));
  }, [data, tier, g]);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loader />;
  return (
    <>
      <section className="fade-in stack">
        <div className="eyebrow">Coverage</div>
        <h1>Leagues & tournaments</h1>
        <p className="sub" style={{ maxWidth: 720 }}>Every competition with ball-by-ball records on Cricsheet. New competitions appear here automatically
          as Cricsheet adds them. Coverage badges show the years held.</p>
      </section>
      <div className="row">
        <Chips label="Level" value={tier} onChange={setTier} options={[['all', 'All'], ['first-class', 'First-class & Tests'], ['list-a', 'One-day'], ['t20', 'T20'], ['hundred', 'The Hundred']]} />
        <Chips label="Gender" value={g} onChange={setG} options={[['all', 'Everyone'], ['male', 'Men'], ['female', 'Women']]} />
      </div>
      {groups.map(([country, list]) => (
        <Panel key={country} title={country} flush>
          <div className="lb">
            {list.map((c: any) => (
              <Link key={c.key} to={`/league/${c.key}`} className="lb-row" style={{ gridTemplateColumns: 'minmax(0,1fr) auto auto' }}>
                <span className="lb-name">{c.label} <span className="muted" style={{ fontWeight: 400 }}>· {TIER[c.tier] ?? c.tier}{c.gender === 'female' ? ' · women' : ''}</span></span>
                <span className="tag">{c.from.slice(0, 4)}–{c.to.slice(0, 4)}</span>
                <span className="lb-val">{n0(c.matches)} <span className="muted" style={{ fontSize: 11, fontWeight: 400 }}>matches</span></span>
              </Link>
            ))}
          </div>
        </Panel>
      ))}
    </>
  );
}
