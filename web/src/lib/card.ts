// Builds the player card from a player's data file: headline numbers, percentile meters, career curve,
// matchup notes and the reveal role. Mirrors the approved mockup.
import { FULL_MEMBERS } from './winline';

type Meter = [string, string, number];
type Pane = { hero: [string, string, string][]; meters: Meter[]; year: [string, number][]; phases: [string, number][]; up: string; dn: string };
export type CardData = {
  key: string; id: string; name: string; full: string; fmt: string; role: 'bat' | 'bowl' | 'all'; roleText: string; team: string;
  span: string; credit: string; photo: string | null; trio: [string, string][]; bat?: Pane; bowl?: Pane;
};

const GROUP: Record<string, string> = { RF: 'right-arm fast', RM: 'right-arm medium', LF: 'left-arm fast', LM: 'left-arm medium', OB: 'off-spin', LB: 'leg-spin', SLA: 'left-arm orthodox', LWS: 'left-arm wrist-spin' };
const BOWL_STYLE: Record<string, string> = {
  rf: 'Right-arm fast', rfm: 'Right-arm fast-medium', rmf: 'Right-arm medium-fast', rm: 'Right-arm medium', rsm: 'Right-arm slow-medium',
  lf: 'Left-arm fast', lfm: 'Left-arm fast-medium', lmf: 'Left-arm medium-fast', lm: 'Left-arm medium',
  ob: 'Off-spin', rs: 'Off-spin', lb: 'Leg-spin', lbg: 'Leg-spin', sla: 'Left-arm orthodox', ls: 'Left-arm orthodox', lws: 'Left-arm wrist-spin',
};
const n1 = (v: number) => v.toLocaleString('en', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const signed = (v: number) => `${v >= 0 ? '+' : '−'}${n1(Math.abs(v))}`;
// "Royal Challengers Bengaluru" -> "RCB"; national sides stay as they are
const shortTeam = (t: string) => (FULL_MEMBERS.has(t.replace(/\s+Women$/i, '')) || t.split(' ').length < 2 ? t.replace(/\s+Women$/i, '') : t.split(/\s+/).map((w) => w[0]).join('').toUpperCase());

export function buildCard(p: any, fk: string, credit: string, photo: string | null): CardData | null {
  const s = p.summary?.[fk], pc = p.pct?.[fk], sp = p.splits?.[fk];
  if (!s || !pc || (!pc.bat && !pc.bowl) || !sp) return null;
  const gender = fk.split('-')[1];
  const role: CardData['role'] = pc.bat && pc.bowl ? 'all' : pc.bowl ? 'bowl' : 'bat';
  const teams = (p.teams ?? []).filter((t: any) => t[1] === gender).sort((a: any, b: any) => b[4] - a[4]);
  const nat = teams.find((t: any) => FULL_MEMBERS.has(String(t[0]).replace(/\s+Women$/i, '')));
  const club = teams.find((t: any) => t !== nat);
  const team = [nat, club].filter(Boolean).slice(0, 2).map((t: any) => shortTeam(t[0])).join(' · ') || shortTeam(teams[0]?.[0] ?? '');
  const years = (p.teams ?? []).flatMap((t: any) => [+t[2], +t[3]]).filter(Number.isFinite);
  const bowlStyle = BOWL_STYLE[p.bowl] ?? 'Bowler';
  const roleText = role === 'bat' ? (p.bat === 'lhb' ? 'Left-hand bat' : 'Right-hand bat') : role === 'bowl' ? bowlStyle : `Bat · ${bowlStyle.toLowerCase()}`;
  const d: CardData = {
    key: p.id, id: p.id, name: p.name, full: p.full && p.full !== p.name ? p.full : p.name, fmt: `${gender === 'female' ? "Women's" : "Men's"} ${fk.split('-')[0] === 'TEST' ? 'Tests' : fk.split('-')[0]}`,
    role, roleText, team, span: years.length ? `${Math.min(...years)}–${Math.max(...years)}` : '', credit, photo, trio: [],
  };
  const phaseName = ['POWERPLAY', 'MIDDLE', 'DEATH'];
  if (pc.bat && s.bat?.b) {
    const a = s.bat, b = pc.bat, x = sp.bat ?? {};
    const avg = a.r / Math.max(a.o, 1), sr = (100 * a.r) / a.b;
    const vs = (x.vs ?? []).filter((r: any) => r[0] !== 'unknown' && r[1] >= 150).map((r: any) => [GROUP[r[0]] ?? r[0], (100 * r[2]) / r[1]] as [string, number]).sort((m: any, n: any) => m[1] - n[1]);
    const phases = (x.phase ?? []).filter((r: any) => r[1]).sort((m: any, n: any) => +m[0] - +n[0]).map((r: any) => [phaseName[+r[0]] ?? r[0], Math.round((100 * r[2]) / r[1])] as [string, number]);
    d.bat = {
      hero: [['Runs', a.r.toLocaleString('en'), `${a.i} inns`], ['Average', n1(avg), `HS ${a.hs ?? '–'}`], ['Strike rate', n1(sr), `${a.c50 ?? 0}×50 · ${a.c100 ?? 0}×100`]],
      meters: [['Average', n1(avg), b.avg], ['Strike rate', n1(sr), b.sr], ['Boundary %', `${n1((100 * (a.f4 + a.s6)) / a.b)}%`, b.bnd], ['Dot balls', `${n1((100 * a.d) / a.b)}%`, b.dotp],
        ['Impact / 100', signed((100 * a.imp) / a.b), b.imp100], ...(b.wpa100 != null ? [['Win prob. added', signed(a.wpa), b.wpa100] as Meter] : [])],
      year: (x.year ?? []).map((r: any) => [String(r[0]), r[2]] as [string, number]).sort((m: any, n: any) => m[0].localeCompare(n[0])),
      phases, up: vs.length ? `${cap(vs[vs.length - 1][0])}: SR ${Math.round(vs[vs.length - 1][1])}` : 'Not enough balls yet', dn: vs.length > 1 ? `${cap(vs[0][0])}: SR ${Math.round(vs[0][1])}` : 'Not enough balls yet',
    };
  }
  if (pc.bowl && s.bowl?.b) {
    const w = s.bowl, b = pc.bowl, x = sp.bowl ?? {};
    const econ = (6 * w.r) / w.b, bavg = w.r / Math.max(w.w, 1), bsr = w.b / Math.max(w.w, 1);
    const phases = (x.phase ?? []).filter((r: any) => r[1]).sort((m: any, n: any) => +m[0] - +n[0]).map((r: any) => [phaseName[+r[0]] ?? r[0], Math.round((600 * r[2]) / r[1]) / 100] as [string, number]);
    const lo = [...phases].sort((m, n) => m[1] - n[1])[0], hi = [...phases].sort((m, n) => n[1] - m[1])[0];
    d.bowl = {
      hero: [['Wickets', w.w.toLocaleString('en'), `${w.i} inns`], ['Economy', econ.toFixed(2), `best ${w.best ?? '–'}`], ['Average', n1(bavg), `SR ${n1(bsr)}`]],
      meters: [['Economy', econ.toFixed(2), b.econ], ['Average', n1(bavg), b.bavg], ['Strike rate', n1(bsr), b.bsr], ['Dot balls', `${n1((100 * w.d) / w.b)}%`, b.dotp],
        ['Impact / 100', signed((100 * w.imp) / w.b), b.imp100], ...(b.wpa100 != null ? [['Win prob. added', signed(w.wpa), b.wpa100] as Meter] : [])],
      year: (x.year ?? []).map((r: any) => [String(r[0]), r[3]] as [string, number]).sort((m: any, n: any) => m[0].localeCompare(n[0])),
      phases, up: lo ? `${cap(lo[0].toLowerCase())}: econ ${lo[1].toFixed(2)}` : '–', dn: hi ? `${cap(hi[0].toLowerCase())}: econ ${hi[1].toFixed(2)}` : '–',
    };
  }
  const main = role === 'bowl' ? d.bowl : d.bat;
  if (!main || !main.year.length) return null;
  const short = (l: string) => l.replace('Strike rate', 'SR').replace('Average', 'Avg').replace('Economy', 'Econ').replace('Wickets', 'Wkts');
  d.trio = role === 'all' && d.bat && d.bowl ? [['Runs', d.bat.hero[0][1]], ['SR', d.bat.hero[2][1]], ['Wkts', d.bowl.hero[0][1]]] : main.hero.map((h) => [short(h[0]), h[1]]);
  return d;
}
