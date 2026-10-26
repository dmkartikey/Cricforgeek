import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useData } from '../lib/data';
import { usePageMeta } from '../lib/meta';
import { dateShort, n0 } from '../lib/fmt';
import { ErrorBox, Loader, Mini, MiniSearch, Panel } from '../components/ui';
import { Table } from '../components/Table';

// venues/index.json: [key, name, city, host, matches, first, last, internationals, {format-gender: matches}]
type Row = [string, string, string | null, string | null, number, string, string, number, Record<string, number>];

export default function Venues() {
  usePageMeta('Cricket grounds: pitch and toss records');
  const { data, error } = useData<Row[]>('venues/index.json');
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<'intl' | 'all'>('intl');
  const rows = useMemo(() => (data ?? []).filter((r) => (kind === 'all' || r[7] >= 5)
    && (!q || `${r[1]} ${r[2] ?? ''} ${r[3] ?? ''}`.toLowerCase().includes(q.toLowerCase()))), [data, q, kind]);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loader text="Loading grounds" />;
  return (
    <>
      <section className="phead fade-in">
        <div className="stack">
          <div className="eyebrow">Grounds</div>
          <h1>Cricket grounds</h1>
          <p className="lede">Every ground with five or more recorded matches: first-innings par, toss decisions and whether they work, pace against spin, and how Test pitches change from day one to day five.</p>
        </div>
      </section>
      <Panel flush title={`${n0(rows.length)} grounds`}
        tools={<>
          <MiniSearch value={q} onChange={setQ} placeholder="Find a ground, city or country" />
          <Mini label="Show" value={kind} onChange={setKind} options={[['intl', 'International grounds'], ['all', 'All grounds']]} />
        </>}>
        <Table rows={rows} sort="n" limit={60} cols={[
          { key: 'name', label: 'Ground', left: true, get: (r) => r[1], fmt: (v, r) => <Link to={`/venue/${r[0]}`}>{v}</Link> },
          { key: 'city', label: 'City', left: true, get: (r) => r[2] ?? '' },
          { key: 'host', label: 'Country', left: true, get: (r) => r[3] ?? '' },
          { key: 'n', label: 'Matches', get: (r) => r[4], fmt: n0 },
          { key: 'i', label: 'Internationals', get: (r) => r[7], fmt: n0 },
          { key: 'l', label: 'Last match', get: (r) => r[6], fmt: (v) => dateShort(String(v)) },
        ]} />
      </Panel>
    </>
  );
}
