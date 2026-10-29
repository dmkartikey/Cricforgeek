// How complete a player's international record is in Cricsheet, for one format.
// Two ways a career can be short of the official record:
//  - it started before Cricsheet's ball-by-ball records for that format begin (men's Tests start in 2001, so most of
//    Tendulkar's Test career is missing), or
//  - Cricsheet is missing some of the matches played during the career.
export type Coverage = { partial: boolean; before: boolean; start: string; from: string; to: string; share: number; missing: number; label: string };

export function coverageOf(p: any, fk: string, cov: any): Coverage | null {
  if (!p || !cov) return null;
  const [fam, g] = fk.split('-');
  if (!['TEST', 'ODI', 'T20'].includes(fam)) return null;
  const intlComp = `${g === 'female' ? 'women' : 'men'}-${fam === 'TEST' ? 'test' : fam === 'ODI' ? 'odi' : 't20i'}`;
  const c = (p.comps ?? []).find((x: any) => x.comp === intlComp);
  const years = cov.years?.[fk];
  if (!c || !years) return null;
  const inns: any[][] = p.inns?.[fk]?.bat ?? p.inns?.[fk]?.bowl ?? [];
  const ys = inns.map((x) => String(x[0]).slice(0, 4)).sort();
  if (!ys.length) return null;
  const from = ys[0], to = ys[ys.length - 1];
  const start = Object.keys(years).sort()[0] ?? from;
  let have = 0, all = 0;
  for (const [y, [h, t]] of Object.entries<[number, number]>(years)) if (y >= from && y <= to) { have += h; all += t; }
  const share = all ? have / all : 1;
  const played = Math.max(c.bat?.i ?? 0, c.bowl?.i ?? 0);
  const missing = Math.round(played * (1 / Math.max(share, 0.3) - 1));
  const before = from <= start;  // first recorded innings in the first year of records: the career likely began earlier
  // only a career that began before the records is flagged as partial: format-wide gaps are mostly other teams' matches
  const partial = before;
  const label = `Partial record · from ${start}`;
  return { partial, before, start, from, to, share, missing, label };
}
