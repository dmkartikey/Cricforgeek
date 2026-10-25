import { useEffect, useState } from 'react';

// A pin is a snapshot of a small ranked list (label, value, bar width) plus a link back to where it came from.
export type PinRow = { l: string; v: string; w: number; href?: string };
export type Pin = { id: string; title: string; ctx: string; href: string; rows: PinRow[]; at: string };
export type Board = { id: string; name: string; pins: Pin[] };

const KEY = 'cfg.pins.v1';
const ev = 'cfg-pins';

export function readBoards(): Board[] {
  try {
    const raw = localStorage.getItem(KEY);
    const b = raw ? JSON.parse(raw) : null;
    if (Array.isArray(b) && b.length) return b;
  } catch { /* ignore */ }
  return [{ id: 'main', name: 'My board', pins: [] }];
}

export function writeBoards(b: Board[]) {
  try { localStorage.setItem(KEY, JSON.stringify(b)); } catch { /* ignore */ }
  window.dispatchEvent(new Event(ev));
}

export function useBoards() {
  const [b, setB] = useState<Board[]>(readBoards);
  useEffect(() => {
    const on = () => setB(readBoards());
    window.addEventListener(ev, on);
    window.addEventListener('storage', on);
    return () => { window.removeEventListener(ev, on); window.removeEventListener('storage', on); };
  }, []);
  return b;
}

export function addPin(p: Omit<Pin, 'at'>, boardId?: string) {
  const b = readBoards();
  const board = b.find((x) => x.id === boardId) ?? b[0];
  board.pins = [{ ...p, at: new Date().toISOString().slice(0, 10) }, ...board.pins.filter((x) => x.id !== p.id)];
  writeBoards(b);
}

export function removePin(id: string) {
  writeBoards(readBoards().map((x) => ({ ...x, pins: x.pins.filter((p) => p.id !== id) })));
}

export const isPinned = (boards: Board[], id: string) => boards.some((b) => b.pins.some((p) => p.id === id));
