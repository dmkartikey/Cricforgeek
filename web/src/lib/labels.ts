export const FAM_LABEL: Record<string, string> = { TEST: 'Test', FC: 'First-class', ODI: 'ODI', LA: 'List A', T20: 'T20', HUN: 'The Hundred', MD: 'Multi-day' };
export const MULTI = (f: string) => f === 'TEST' || f === 'FC' || f === 'MD';
export const GENDER_LABEL: Record<string, string> = { male: 'Men', female: 'Women' };

export const famKeyLabel = (key: string) => {
  const [fam, g] = key.split('-');
  return `${GENDER_LABEL[g] ?? g} · ${FAM_LABEL[fam] ?? fam}`;
};

export const PHASES: Record<string, [string, string, string]> = {
  T20: ['Powerplay (1–6)', 'Middle (7–15)', 'Death (16–20)'],
  HUN: ['Powerplay (1–25)', 'Middle (26–75)', 'Death (76–100)'],
  ODI: ['Powerplay (1–10)', 'Middle (11–40)', 'Death (41–50)'],
  MD: ['New ball (1–20)', 'Middle (21–80)', 'Old ball (81+)'],
};
PHASES.TEST = PHASES.MD; PHASES.FC = PHASES.MD; PHASES.LA = PHASES.ODI;

export const BGRP: Record<string, string> = {
  RF: 'Right-arm fast', RM: 'Right-arm medium', LF: 'Left-arm fast', LM: 'Left-arm medium',
  OB: 'Off-spin', LB: 'Leg-spin', SLA: 'Left-arm orthodox', LWS: 'Left-arm wrist-spin', unknown: 'Style unknown',
};

export const STYLE: Record<string, string> = {
  rhb: 'Right-hand bat', lhb: 'Left-hand bat',
  rf: 'Right-arm fast', rfm: 'Right-arm fast-medium', rmf: 'Right-arm medium-fast', rm: 'Right-arm medium',
  rsm: 'Right-arm slow-medium', lf: 'Left-arm fast', lfm: 'Left-arm fast-medium', lmf: 'Left-arm medium-fast',
  lm: 'Left-arm medium', ob: 'Right-arm off-break', lb: 'Right-arm leg-break', lbg: 'Leg-break googly',
  sla: 'Slow left-arm orthodox', lws: 'Left-arm wrist-spin', rs: 'Right-arm slow', ls: 'Left-arm slow',
  rab: 'Right-arm bowler', lab: 'Left-arm bowler',
};

export const DCAT: Record<string, string> = {
  bowled: 'Bowled', lbw: 'LBW', keeper: 'Caught behind', stumped: 'Stumped', cab: 'Caught & bowled',
  field: 'Caught in the field', hitwicket: 'Hit wicket', runout: 'Run out',
};

export const LEV: Record<string, string> = { low: 'Low leverage', mid: 'Medium leverage', high: 'High leverage' };
export const INN: Record<string, string> = { '1': '1st innings', '2': '2nd innings', '3': '3rd innings', '4': '4th innings' };
export const POS = (k: string) => (k === '9' ? '9+' : k === '1' || k === '2' ? `Opener (${k})` : `No. ${k}`);
export const TIER: Record<string, string> = { 'first-class': 'First-class', 'list-a': 'List A / one-day', t20: 'T20', hundred: 'The Hundred', other: 'Other' };
