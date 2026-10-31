// The nets coach: reads a measured spell the way a bowling coach would and says what went well, what to work on,
// and which drill fixes it. Rules come from how the game is coached and how ball-tracking data is read (lengths and
// the "corridor" outside off stump, consistency over a spell, movement relative to the batter).
// Every number it quotes comes from the measurements; balls measured loosely (wide +-) are left out of fine points.
import { STUMP_W, STUMP_H, BALL_R } from './geom'
import type { Result } from './fit'

export type Hand = 'R' | 'L'
export type Kind = 'pace' | 'spin'
export type Tone = 'good' | 'work' | 'info'
export type Insight = { tone: Tone; title: string; detail: string; drill?: string; area: string }
export type CoachReport = {
  kind: Kind; kindAuto: boolean; score: number; headline: string
  insights: Insight[]; focus: Insight[]; best?: { index: number; why: string }
  zones: { name: string; count: number; target: boolean }[]
}

const HALF = STUMP_W / 2
// length bands (metres from the batter's stumps) as ball-tracking data usually splits them
const ZONES: Record<Kind, [string, number, number, boolean][]> = {
  pace: [['Yorker', -1.5, 2, false], ['Full', 2, 6, false], ['Good length', 6, 8, true], ['Short of a length', 8, 10, false], ['Short', 10, 16, false]],
  spin: [['Full', -1.5, 2.5, false], ['Over-pitched', 2.5, 3.5, false], ['Good length', 3.5, 5.5, true], ['Short of a length', 5.5, 7, false], ['Short', 7, 16, false]],
}

export function lengthZone(m: number | undefined, kind: Kind): string {
  if (m === undefined) return 'Full toss'
  return ZONES[kind].find(([, a, b]) => m >= a && m < b)?.[0] ?? (m < 0 ? 'Full toss' : 'Short')
}

const pct = (a: number, b: number) => (b ? Math.round((100 * a) / b) : 0)
const mean = (x: number[]) => x.reduce((s, v) => s + v, 0) / Math.max(x.length, 1)
const sd = (x: number[]) => { const m = mean(x); return Math.sqrt(mean(x.map(v => (v - m) ** 2))) }
const cm = (m: number) => `${Math.round(Math.abs(m) * 100)} cm`

export function coach(results: Result[], hand: Hand, kindIn?: Kind): CoachReport {
  const rs = results
  const n = rs.length
  const speeds = rs.map(r => r.speedKmh)
  const kindAuto = !kindIn
  const kind: Kind = kindIn ?? (mean(speeds) < 95 ? 'spin' : 'pace')
  const off = (y: number) => (hand === 'R' ? y : -y) // + is the batter's off side
  const tight = rs.filter(r => (r.speedSd ?? 0) < 6) // measured firmly enough for fine points
  const ins: Insight[] = []

  // ---------------------------------------------------------------- pace
  const avg = mean(speeds), top = Math.max(...speeds)
  ins.push({ tone: 'info', area: 'Pace', title: `${n} balls at an average of ${avg.toFixed(1)} km/h, top ${top.toFixed(1)} km/h`,
    detail: kind === 'pace' ? `Pace varied by ±${sd(speeds).toFixed(1)} km/h from ball to ball.` : `Speed through the air varied by ±${sd(speeds).toFixed(1)} km/h.` })
  if (n >= 6) {
    const k = Math.max(2, Math.floor(n / 3))
    const early = mean(speeds.slice(0, k)), late = mean(speeds.slice(-k))
    const drop = early - late
    if (kind === 'pace' && drop > 3) ins.push({ tone: 'work', area: 'Pace', title: `Pace dropped ${drop.toFixed(1)} km/h through the spell`,
      detail: `First ${k} balls averaged ${early.toFixed(1)} km/h, the last ${k} ${late.toFixed(1)} km/h. That is usually tiredness or the run-up shortening.`,
      drill: 'Bowl in sets of 6 with a full minute of rest between them, and mark your run-up so it stays the same length.' })
    else if (kind === 'pace' && drop < -3) ins.push({ tone: 'info', area: 'Pace', title: `You got quicker as the spell went on (+${(-drop).toFixed(1)} km/h)`,
      detail: 'Fine in the nets, but bowl a proper warm-up over before you start in a match so the first balls are at full pace too.' })
    if (kind === 'spin') {
      const v = sd(speeds)
      if (v < 2) ins.push({ tone: 'work', area: 'Variation', title: 'Little change of pace', detail: `Every ball came out within about ${v.toFixed(1)} km/h. Good batters line up a spinner who never changes speed.`,
        drill: 'Bowl overs of 6 where balls 2 and 5 are 5–8 km/h slower with more loop, landing on the same spot.' })
      else if (v > 6) ins.push({ tone: 'work', area: 'Variation', title: 'Pace all over the place', detail: `Speeds spread by ±${v.toFixed(1)} km/h. Change of pace works when it's chosen, not when it just happens.`,
        drill: 'Groove a stock ball first: 3 overs at one pace onto a target mat, then add variations one at a time.' })
    }
  }

  // ---------------------------------------------------------------- length
  const withLen = rs.filter(r => r.lengthM !== undefined)
  const zones = ZONES[kind].map(([name, a, b, target]) => ({ name, target, count: withLen.filter(r => r.lengthM! >= a && r.lengthM! < b).length }))
  const fullTosses = rs.length - withLen.length
  if (fullTosses) zones.unshift({ name: 'Full toss', target: false, count: fullTosses })
  const good = zones.find(z => z.target)!.count
  const [, gLo, gHi] = ZONES[kind].find(z => z[3])!
  if (withLen.length >= 3) {
    const share = pct(good, n)
    const lens = withLen.map(r => r.lengthM!)
    const tooFull = lens.filter(l => l < gLo).length + fullTosses, tooShort = lens.filter(l => l >= gHi).length
    if (share >= 60) ins.push({ tone: 'good', area: 'Length', title: `${share}% on a good length`, detail: `${good} of ${n} landed ${gLo}–${gHi} m from the batter's stumps. That is a tidy spell.` })
    else ins.push({ tone: 'work', area: 'Length', title: `Only ${share}% on a good length`,
      detail: `${good} of ${n} landed ${gLo}–${gHi} m out. ${tooShort > tooFull ? `${tooShort} were short of it` : `${tooFull} were too full`}, ${tooShort > tooFull ? `on average ${(mean(lens.filter(l => l >= gHi)) - gHi + 0.01).toFixed(1)} m too short` : 'pitched up past the good length'}.`,
      drill: `Put a towel or target mat ${gLo}–${gHi} m from the stumps and count hits per over; aim for 4 of 6 before moving it.` })
    const sl = sd(lens)
    if (sl > 1.6) ins.push({ tone: 'work', area: 'Length', title: 'Length is inconsistent', detail: `Lengths spread by ±${sl.toFixed(1)} m. Repeating your release point is the usual fix.`,
      drill: 'Bowl from a shorter run-up to the target mat until 5 of 6 land on it, then go back to the full run.' })
    else if (sl < 0.8 && share >= 50) ins.push({ tone: 'good', area: 'Length', title: 'Very repeatable length', detail: `Lengths stayed within ±${sl.toFixed(1)} m.` })
    if (n >= 6) {
      const k = Math.max(2, Math.floor(withLen.length / 3))
      const d = mean(lens.slice(-k)) - mean(lens.slice(0, k))
      if (Math.abs(d) > 1.2) ins.push({ tone: 'work', area: 'Length', title: `Length drifted ${d > 0 ? 'shorter' : 'fuller'} as the spell went on`,
        detail: `The last balls landed ${Math.abs(d).toFixed(1)} m ${d > 0 ? 'shorter' : 'fuller'} than the first. ${d > 0 && kind === 'pace' ? 'Shorter balls late in a spell often come from tiring and falling away at the crease.' : ''}`,
        drill: 'Every 6 balls, check one against the target mat before carrying on.' })
    }
    // good-length balls that would go over the top of the stumps
    const over = withLen.filter(r => r.lengthM! >= gLo && r.lengthM! < gHi && r.heightZ !== undefined && r.heightZ > STUMP_H + BALL_R && Math.abs(r.lineY ?? 9) <= HALF + BALL_R)
    if (kind === 'pace' && over.length >= 2) ins.push({ tone: 'work', area: 'Length', title: `${over.length} straight balls would have bounced over the stumps`,
      detail: `They were on a good length and straight but passed the stumps above ${Math.round(STUMP_H * 100)} cm. On this pitch, half a metre fuller brings bowled and LBW into play.` })
    const yorkers = withLen.filter(r => r.lengthM! < 2)
    if (kind === 'pace' && yorkers.length >= 2) {
      const onTarget = yorkers.filter(r => r.lengthM! < 1 && Math.abs(r.lineY ?? 9) < 0.3).length
      ins.push({ tone: onTarget >= yorkers.length / 2 ? 'good' : 'work', area: 'Yorkers', title: `${onTarget} of ${yorkers.length} yorkers nailed`,
        detail: 'A nailed yorker lands within a metre of the stumps and in line with them.', drill: onTarget >= yorkers.length / 2 ? undefined : 'Shoe on the popping crease: 3 sets of 6 aiming to hit it.' })
    }
  }

  // ---------------------------------------------------------------- line
  const withLine = rs.filter(r => r.lineY !== undefined)
  if (withLine.length >= 3) {
    const lines = withLine.map(r => off(r.lineY!))
    const hitting = withLine.filter(r => Math.abs(r.lineY!) <= HALF + BALL_R && (r.heightZ ?? 9) <= STUMP_H + BALL_R).length
    const corridor = lines.filter(y => y >= HALF - 0.05 && y <= HALF + 0.3).length
    const leg = lines.filter(y => y < -HALF - BALL_R).length, wide = lines.filter(y => y > HALF + 0.45).length
    if (kind === 'pace') {
      const share = pct(corridor, withLine.length)
      ins.push({ tone: share >= 50 ? 'good' : 'work', area: 'Line', title: `${share}% in the corridor outside off`,
        detail: `${corridor} of ${withLine.length} passed the stumps between off stump and 30 cm outside it, where the batter has to decide whether to play.` +
          (leg > 1 ? ` ${leg} drifted onto or down the leg side.` : '') + (wide > 1 ? ` ${wide} were wide enough to leave.` : ''),
        drill: share >= 50 ? undefined : 'Put two cones at the far end, one on off stump and one 30 cm outside it, and bowl at the gap.' })
    } else {
      ins.push({ tone: hitting / withLine.length >= 0.4 ? 'good' : 'work', area: 'Line', title: `${pct(hitting, withLine.length)}% would have hit the stumps`,
        detail: `For a spinner, attacking the stumps brings bowled, LBW and stumped into play. ${leg > 1 ? `${leg} strayed down the leg side.` : ''}`,
        drill: hitting / withLine.length >= 0.4 ? undefined : 'Bowl at a single stump with a target on a good length; count stump hits per over.' })
    }
    if (hitting) ins.push({ tone: 'info', area: 'Line', title: `${hitting} ball${hitting > 1 ? 's' : ''} hitting the stumps`, detail: 'Missed by the batter, these would have been bowled or a strong LBW shout.' })
    const s = sd(lines)
    if (s > 0.35) ins.push({ tone: 'work', area: 'Line', title: 'Line is spraying', detail: `Lines at the stumps spread by ±${cm(s)}.`,
      drill: 'Check your front foot lands in line with the stumps and your bowling arm comes over straight; film from behind to see it.' })
    const bias = mean(lines)
    if (kind === 'pace' && bias < -0.05) ins.push({ tone: 'work', area: 'Line', title: 'Too straight, drifting towards the pads', detail: `On average the ball passed ${cm(bias)} on the leg side of middle stump. That feeds the batter's pads and leg-side shots.` })
  }

  // ---------------------------------------------------------------- movement
  const mov = tight.filter(r => r.swingM !== undefined)
  if (kind === 'pace' && mov.length >= 3) {
    // + towards the batter's off side = away from a right-hander's body: outswing for a right-hander
    const sw = mov.map(r => off(r.swingM!))
    const big = sw.filter(s => Math.abs(s) > 0.12)
    if (big.length >= Math.max(2, mov.length / 3)) {
      const out = big.filter(s => s > 0).length, inn = big.length - out
      const dir = out >= inn ? 'away from the batter (outswing)' : 'into the batter (inswing)'
      ins.push({ tone: 'good', area: 'Swing', title: `Swinging ${dir}`, detail: `${big.length} of ${mov.length} balls moved more than 12 cm in the air, on average ${cm(mean(big.map(Math.abs)))}. ${out && inn ? `It went both ways (${out} away, ${inn} in): if that isn't deliberate, check the seam position at release.` : ''}` })
    } else ins.push({ tone: 'info', area: 'Swing', title: 'Not much swing', detail: `The ball moved ${cm(mean(sw.map(Math.abs)))} in the air on average. Swing needs an upright seam and one shiny side; it also depends on the ball and the air.`,
      drill: 'Wobble-free seam drill: bowl to a partner from 10 m with the seam pointing at first slip, then lengthen.' })
    const seam = tight.filter(r => r.lengthM !== undefined).map(r => Math.abs(r.devDeg))
    if (seam.length >= 3 && mean(seam) > 1.5) ins.push({ tone: 'good', area: 'Seam', title: `Seaming off the pitch, ${mean(seam).toFixed(1)}° on average`, detail: 'Sideways movement after pitching is hard to play from a good length.' })
  }
  if (kind === 'spin') {
    const turn = tight.filter(r => r.lengthM !== undefined).map(r => off(Math.sin((r.devDeg * Math.PI) / 180)))
    if (turn.length >= 3) {
      const m = mean(turn.map(Math.abs)) * 180 / Math.PI
      const away = turn.filter(t => t > 0).length
      ins.push({ tone: m > 3 ? 'good' : 'work', area: 'Turn', title: `Turning ${m.toFixed(1)}° on average, ${away > turn.length / 2 ? 'away from' : 'into'} the batter`,
        detail: m > 3 ? 'Real turn: keep giving it a rip.' : 'Not much turn. More revolutions on the ball come from the fingers or wrist working, not the arm speed.',
        drill: m > 3 ? undefined : 'Spin a ball up to yourself and against a wall from 5 m, counting rotations; then bowl to a partner from half distance.' })
    }
  }

  // ---------------------------------------------------------------- bouncers
  const bouncers = rs.filter(r => (r.lengthM ?? 0) > 9 && (r.heightZ ?? 0) > 1.3)
  if (kind === 'pace' && bouncers.length) ins.push({ tone: 'info', area: 'Short ball', title: `${bouncers.length} bouncer${bouncers.length > 1 ? 's' : ''} above chest height`,
    detail: `Reaching ${Math.round(Math.max(...bouncers.map(r => r.heightZ!)) * 100)} cm at the stumps. Used sparingly, with the line at the body, it sets up the full ball.` })

  // ---------------------------------------------------------------- best ball and score
  let best: CoachReport['best']
  let bestScore = -1
  rs.forEach((r, i) => {
    if (r.lengthM === undefined || r.lineY === undefined) return
    const inLen = r.lengthM >= gLo && r.lengthM < gHi ? 1 : r.lengthM < 1.2 ? 0.9 : 0.3
    const y = off(r.lineY)
    const inLine = Math.abs(r.lineY) <= HALF + BALL_R && (r.heightZ ?? 9) <= STUMP_H + BALL_R ? 1 : y >= HALF - 0.05 && y <= HALF + 0.3 ? 0.8 : 0.2
    const move = Math.min(1, (Math.abs(r.swingM ?? 0) / 0.2) + Math.abs(r.devDeg) / 4)
    const s = inLen * inLine * (0.6 + 0.4 * move) * (kind === 'pace' ? r.speedKmh / Math.max(top, 1) : 1)
    if (s > bestScore) {
      bestScore = s
      best = { index: i, why: `${r.speedKmh.toFixed(1)} km/h, ${lengthZone(r.lengthM, kind).toLowerCase()} (${r.lengthM.toFixed(1)} m)${Math.abs(r.lineY) <= HALF + BALL_R ? ', hitting the stumps' : ''}${Math.abs(r.swingM ?? 0) > 0.12 ? `, swinging ${cm(r.swingM!)}` : ''}${Math.abs(r.devDeg) > 2 ? `, ${Math.abs(r.devDeg).toFixed(1)}° off the pitch` : ''}.` }
    }
  })
  const lenShare = n ? good / n : 0
  const lineShare = withLine.length ? withLine.filter(r => { const y = off(r.lineY!); return Math.abs(r.lineY!) <= HALF + BALL_R || (y >= HALF - 0.05 && y <= HALF + 0.3) }).length / withLine.length : 0
  const consist = withLen.length >= 3 ? Math.max(0, 1 - sd(withLen.map(r => r.lengthM!)) / 3) : 0.5
  const score = Math.round(100 * (0.4 * lenShare + 0.4 * lineShare + 0.2 * consist))

  const work = ins.filter(i => i.tone === 'work')
  const focus = work.filter(i => i.drill).slice(0, 2)
  const headline = score >= 70 ? 'A disciplined spell: keep it going.' : score >= 45 ? 'Good bits in there; tighten the basics below.' : 'Plenty to work on: start with the two priorities below.'
  return { kind, kindAuto, score, headline, insights: ins, focus, best, zones }
}

// ---------------------------------------------------------------- the batter's view of the same session
export type Shot = { outcome: 'attacking' | 'defended' | 'edged' | 'not hit' | 'bowled' | 'unclear' | 'left' | 'missed'; exitKmh?: number; azimuthDeg?: number; elevationDeg?: number; inAir?: boolean }
export type Faced = { result: Result; shot?: Shot }
export type BatReport = {
  score: number; headline: string; insights: Insight[]; focus: Insight[]
  grid: { len: string; line: string; balls: number; hit: number; avgExit: number | null }[]
  shots: { az: number; kmh: number; air: boolean; i: number }[]
}

/** Coaching for the batter: what they faced, how they handled each kind of ball, decisions, and where they score. */
export function coachBatter(faced: Faced[], hand: Hand, kindIn?: Kind): BatReport {
  const n = faced.length
  const kind: Kind = kindIn ?? (mean(faced.map(f => f.result.speedKmh)) < 95 ? 'spin' : 'pace')
  const off = (y: number) => (hand === 'R' ? y : -y)
  const ins: Insight[] = []
  const known = faced.filter(f => f.shot && f.shot.outcome !== 'unclear')
  const played = known.filter(f => ['attacking', 'defended', 'edged'].includes(f.shot!.outcome))
  const notHit = known.filter(f => ['not hit', 'left', 'missed', 'bowled'].includes(f.shot!.outcome))
  const bowled = known.filter(f => f.shot!.outcome === 'bowled')
  const edged = known.filter(f => f.shot!.outcome === 'edged')
  const attacking = known.filter(f => f.shot!.outcome === 'attacking')
  const onStumps = (r: Result) => r.lineY !== undefined && Math.abs(r.lineY) <= HALF + BALL_R && (r.heightZ ?? 9) <= STUMP_H + BALL_R
  const wideOff = (r: Result) => r.lineY !== undefined && off(r.lineY) > HALF + 0.3

  ins.push({ tone: 'info', area: 'Faced', title: `${n} balls faced at ${mean(faced.map(f => f.result.speedKmh)).toFixed(1)} km/h on average`,
    detail: `${pct(faced.filter(f => onStumps(f.result)).length, n)}% were on line to hit the stumps; ${pct(faced.filter(f => (f.result.lengthM ?? 0) >= 8).length, n)}% were short.` +
      (known.length < n ? ` What happened after the ball reached you is clear on ${known.length} of them.` : '') })
  if (!known.length) return { score: 0, headline: 'What you faced', insights: ins, focus: [], grid: [], shots: [] }

  // decisions: leaving straight balls, playing at wide ones
  const leftStraight = notHit.filter(f => onStumps(f.result))
  if (bowled.length) ins.push({ tone: 'work', area: 'Decisions', title: `Bowled ${bowled.length} time${bowled.length > 1 ? 's' : ''}`,
    detail: `${bowled.map(f => `${f.result.speedKmh.toFixed(0)} km/h ${lengthZone(f.result.lengthM, kind).toLowerCase()}`).join('; ')}. Play at anything that would hit the stumps.`,
    drill: 'Throw-downs on a good length at the stumps: defend every ball with the bat close to the pad, 3 sets of 10.' })
  else if (leftStraight.length) ins.push({ tone: 'work', area: 'Decisions', title: `${leftStraight.length} ball${leftStraight.length > 1 ? 's' : ''} on the stumps not played`,
    detail: 'They would have hit the stumps. Know where your off stump is.', drill: 'Gate drill: a cone just outside off; leave only what passes outside it.' })
  const chased = played.filter(f => wideOff(f.result))
  if (chased.length >= 2) ins.push({ tone: 'work', area: 'Decisions', title: `Played at ${chased.length} wide balls outside off`,
    detail: `${chased.filter(f => f.shot!.outcome === 'edged').length} of them took an edge. Balls 30 cm or more outside off can be left early in an innings.`,
    drill: 'Leave practice: a partner feeds a mix of balls; call "leave" out loud for anything outside the cone before you move.' })
  const goodLeaves = notHit.filter(f => wideOff(f.result) && f.shot!.outcome !== 'bowled')
  if (goodLeaves.length >= 2) ins.push({ tone: 'good', area: 'Decisions', title: `${goodLeaves.length} good leaves outside off`, detail: 'Wide balls left alone: that builds an innings.' })

  // contact and edges
  if (edged.length) ins.push({ tone: 'work', area: 'Contact', title: `${edged.length} edge${edged.length > 1 ? 's' : ''}`,
    detail: `Off ${edged.map(f => `${lengthZone(f.result.lengthM, kind).toLowerCase()} balls ${f.result.lineY !== undefined ? (off(f.result.lineY) > HALF ? 'outside off' : 'on the stumps') : ''}`).join('; ')}. Edges usually mean playing away from the body or with hard hands.`,
    drill: 'Soft-hands drill: throw-downs at off stump, let the ball come to you and drop it at your feet.' })
  const middled = played.filter(f => f.shot!.outcome !== 'edged')
  if (played.length >= 3) ins.push({ tone: middled.length / played.length >= 0.75 ? 'good' : 'work', area: 'Contact',
    title: `${pct(middled.length, played.length)}% of the balls you played were met cleanly`, detail: `${middled.length} of ${played.length}.` })

  // scoring: hard-hit shots, where, and which balls
  if (attacking.length) {
    const ex = attacking.map(f => f.shot!.exitKmh ?? 0)
    const air = attacking.filter(f => f.shot!.inAir)
    const offSide = attacking.filter(f => off(Math.sin(((f.shot!.azimuthDeg ?? 0) * Math.PI) / 180)) > 0.2).length
    const legSide = attacking.filter(f => off(Math.sin(((f.shot!.azimuthDeg ?? 0) * Math.PI) / 180)) < -0.2).length
    ins.push({ tone: 'good', area: 'Scoring', title: `${attacking.length} attacking shots, average ${mean(ex).toFixed(0)} km/h off the bat`,
      detail: `Hardest ${Math.max(...ex).toFixed(0)} km/h. ${offSide} to the off side, ${legSide} to the leg side, ${attacking.length - offSide - legSide} straight.${air.length ? ` ${air.length} went in the air.` : ''}` })
    if (air.length >= 2 && air.length / attacking.length > 0.4) ins.push({ tone: 'work', area: 'Scoring', title: 'Lots of shots in the air',
      detail: `${air.length} of ${attacking.length} attacking shots were lofted. In the nets that's fine if deliberate; in a match it's a catch.`,
      drill: 'Keep-it-down drill: drives into a net with a line taped at knee height; anything over the line doesn\'t count.' })
    // which lengths they score off and which they don't
    const byLen = (f: Faced) => lengthZone(f.result.lengthM, kind)
    const zonesHit = new Map<string, number[]>()
    attacking.forEach(f => { const z = byLen(f); zonesHit.set(z, [...(zonesHit.get(z) ?? []), f.shot!.exitKmh ?? 0]) })
    const bestZ = [...zonesHit.entries()].sort((a, b) => mean(b[1]) - mean(a[1]))[0]
    if (bestZ) ins.push({ tone: 'good', area: 'Scoring', title: `Strongest against ${bestZ[0].toLowerCase()} balls`, detail: `Average ${mean(bestZ[1]).toFixed(0)} km/h off the bat from ${bestZ[1].length} shot${bestZ[1].length > 1 ? 's' : ''}.` })
  }
  const short = known.filter(f => (f.result.lengthM ?? 0) >= (kind === 'pace' ? 8 : 5.5))
  const shortHit = short.filter(f => f.shot!.outcome === 'attacking')
  if (short.length >= 3 && shortHit.length / short.length < 0.3) ins.push({ tone: 'work', area: 'Short ball', title: `Rarely punished the short ball`,
    detail: `${shortHit.length} of ${short.length} short balls were attacked.`, drill: 'Pull and cut practice off a side-arm or bowling machine, short of a length, 3 sets of 10.' })
  const full = known.filter(f => (f.result.lengthM ?? 99) < (kind === 'pace' ? 6 : 3.5))
  const fullHit = full.filter(f => f.shot!.outcome === 'attacking')
  if (full.length >= 3 && fullHit.length / full.length < 0.4) ins.push({ tone: 'work', area: 'Full ball', title: 'Full balls going unpunished',
    detail: `${fullHit.length} of ${full.length} full balls were driven hard. Get the front foot to the pitch of the ball.`, drill: 'Drive drill: half-volleys on a target spot, step to the ball and hit through the line.' })

  // a 3 x 3 grid: length band x line (off / stumps / leg), balls faced, played and how hard
  const lenBand = (r: Result) => r.lengthM === undefined ? 'Full' : r.lengthM < (kind === 'pace' ? 6 : 3.5) ? 'Full' : r.lengthM < (kind === 'pace' ? 8 : 5.5) ? 'Good' : 'Short'
  const lineBand = (r: Result) => r.lineY === undefined ? 'Stumps' : off(r.lineY) > HALF + BALL_R ? 'Off' : off(r.lineY) < -HALF - BALL_R ? 'Leg' : 'Stumps'
  const grid: BatReport['grid'] = []
  for (const len of ['Full', 'Good', 'Short']) for (const line of ['Off', 'Stumps', 'Leg']) {
    const c = known.filter(f => lenBand(f.result) === len && lineBand(f.result) === line)
    const h = c.filter(f => f.shot!.outcome === 'attacking')
    grid.push({ len, line, balls: c.length, hit: h.length, avgExit: h.length ? mean(h.map(f => f.shot!.exitKmh ?? 0)) : null })
  }
  const shots = faced.map((f, i) => ({ f, i })).filter(({ f }) => f.shot?.outcome === 'attacking' && f.shot.azimuthDeg !== undefined)
    .map(({ f, i }) => ({ az: f.shot!.azimuthDeg!, kmh: f.shot!.exitKmh ?? 0, air: !!f.shot!.inAir, i }))

  const decisions = 1 - (bowled.length + leftStraight.length + chased.length) / Math.max(known.length, 1)
  const contact = played.length ? middled.length / played.length : 1
  const scoring = known.length ? Math.min(1, attacking.length / Math.max(1, known.filter(f => !wideOff(f.result)).length)) : 0
  const score = Math.round(100 * (0.4 * Math.max(0, decisions) + 0.35 * contact + 0.25 * scoring))
  const focus = ins.filter(i => i.tone === 'work' && i.drill).slice(0, 2)
  const headline = score >= 70 ? 'Solid batting: good decisions and clean contact.' : score >= 45 ? 'Some good shots; tidy up the points below.' : 'Plenty to work on: start with the two priorities below.'
  return { score, headline, insights: ins, focus, grid, shots }
}
