import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Board, readBoards, removePin, useBoards, writeBoards } from '../lib/pins';
import { Panel } from '../components/ui';

export default function Pinboard() {
  const boards = useBoards();
  const [cur, setCur] = useState(boards[0]?.id ?? 'main');
  const [cols, setCols] = useState<'2' | '3'>('2');
  const b: Board = boards.find((x) => x.id === cur) ?? boards[0];
  const addBoard = () => {
    const name = window.prompt('Name the new board', 'New board');
    if (!name) return;
    const id = `b${Date.now().toString(36)}`;
    writeBoards([...readBoards(), { id, name, pins: [] }]);
    setCur(id);
  };
  const rename = () => {
    const name = window.prompt('Rename board', b.name);
    if (name) writeBoards(readBoards().map((x) => (x.id === b.id ? { ...x, name } : x)));
  };
  const del = () => {
    if (boards.length < 2 || !window.confirm(`Delete "${b.name}" and its pins?`)) return;
    const rest = readBoards().filter((x) => x.id !== b.id);
    writeBoards(rest);
    setCur(rest[0].id);
  };
  const move = (id: string, d: number) => {
    const all = readBoards();
    const x = all.find((y) => y.id === b.id)!;
    const i = x.pins.findIndex((p) => p.id === id), j = i + d;
    if (j < 0 || j >= x.pins.length) return;
    [x.pins[i], x.pins[j]] = [x.pins[j], x.pins[i]];
    writeBoards(all);
  };
  return (
    <>
      <section className="phead fade-in">
        <div className="stack">
          <div className="eyebrow">My pinboard · saved in this browser</div>
          <h1>{b.name}</h1>
          <p className="lede">{b.pins.length} pin{b.pins.length === 1 ? '' : 's'}. Pin any leaderboard or chart with the pin icon in its corner. Each pin is a snapshot from the day you pinned it, with a link back to the live view.</p>
        </div>
        <div className="row">
          <div className="seg" role="group" aria-label="Layout">
            <button type="button" aria-pressed={cols === '2'} onClick={() => setCols('2')}>2 columns</button>
            <button type="button" aria-pressed={cols === '3'} onClick={() => setCols('3')}>3 columns</button>
          </div>
          <button className="btn" onClick={addBoard}>New board</button>
        </div>
      </section>
      <div className="tabs" role="tablist" aria-label="Boards">
        {boards.map((x) => <button key={x.id} role="tab" aria-selected={x.id === b.id} onClick={() => setCur(x.id)}>{x.name} <span className="muted">{x.pins.length}</span></button>)}
        <span className="spacer" />
        <button onClick={rename}>Rename</button>
        {boards.length > 1 && <button onClick={del}>Delete board</button>}
      </div>
      {b.pins.length ? (
        <div className="pin-grid" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${cols === '3' ? 320 : 460}px), 1fr))` }}>
          {b.pins.map((p, n) => (
            <Panel key={p.id} flush className="pin-card" eyebrow={p.ctx} title={p.title}
              right={<>
                <button className="icon-btn" aria-label="Move earlier" disabled={n === 0} onClick={() => move(p.id, -1)}>↑</button>
                <button className="icon-btn" aria-label="Move later" disabled={n === b.pins.length - 1} onClick={() => move(p.id, 1)}>↓</button>
                <Link className="btn" style={{ height: 28 }} to={p.href}>Open</Link>
                <button className="icon-btn" aria-label="Unpin" onClick={() => removePin(p.id)}>×</button>
              </>}
              foot={`Pinned ${p.at}`}>
              {p.rows.map((r, i) => (
                <div key={i} className="pin-row">
                  {r.href ? <Link className="link" to={r.href}>{r.l}</Link> : <span>{r.l}</span>}
                  <span className="rl-bar"><i style={{ width: `${Math.max(3, Math.min(1, r.w) * 100)}%` }} /></span>
                  <b>{r.v}</b>
                </div>
              ))}
            </Panel>
          ))}
        </div>
      ) : (
        <div className="notice info">This board is empty. Open the <Link className="link" to="/">overview</Link> or any player page and press the pin icon on a panel.</div>
      )}
    </>
  );
}
