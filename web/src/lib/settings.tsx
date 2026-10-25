import { createContext, ReactNode, useContext, useEffect, useState } from 'react';

export type Fmt = 'TEST' | 'FC' | 'ODI' | 'LA' | 'T20' | 'HUN';
export type Gender = 'male' | 'female';
export type Level = 'top' | 'intl' | 'all';
export type Theme = 'light' | 'dark' | 'system';

export const FMTS: { k: Fmt; l: string; s: string }[] = [
  { k: 'TEST', l: 'Test', s: 'since 2001' },
  { k: 'ODI', l: 'ODI', s: '50 overs' },
  { k: 'T20', l: 'T20', s: 'intl + leagues' },
  { k: 'FC', l: 'First-class', s: 'domestic' },
  { k: 'LA', l: 'List A', s: 'domestic 50' },
  { k: 'HUN', l: 'Hundred', s: '100 balls' },
];
export const LEVELS: [Level, string][] = [['top', 'Full members + major leagues'], ['intl', 'Internationals only'], ['all', 'Everything']];

type S = { fmt: Fmt; gender: Gender; level: Level; theme: Theme };
type Ctx = S & { set: (p: Partial<S>) => void };
const C = createContext<Ctx | null>(null);
const KEY = 'cfg.settings.v3';

const read = (): S => {
  const d: S = { fmt: 'T20', gender: 'male', level: 'top', theme: 'light' };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...d, ...JSON.parse(raw) };
  } catch { /* storage blocked */ }
  return d;
};

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [s, setS] = useState<S>(read);
  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
    const el = document.documentElement;
    if (s.theme === 'system') el.removeAttribute('data-theme'); else el.setAttribute('data-theme', s.theme);
  }, [s]);
  return <C.Provider value={{ ...s, set: (p) => setS((o) => ({ ...o, ...p })) }}>{children}</C.Provider>;
}

export function useSettings() {
  const c = useContext(C);
  if (!c) throw new Error('SettingsProvider missing');
  return c;
}

// True when the page is drawn in dark colours (explicit choice or system preference).
export function useDark() {
  const { theme } = useSettings();
  const [sys, setSys] = useState(() => typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    const m = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!m) return;
    const on = () => setSys(m.matches);
    m.addEventListener?.('change', on);
    return () => m.removeEventListener?.('change', on);
  }, []);
  return theme === 'dark' || (theme === 'system' && sys);
}
