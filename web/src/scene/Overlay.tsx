// Everything drawn on top of the islands: troop chips, order arcs, scout path, battle rings,
// selection, rumored enemy capitals.
import { Html, QuadraticBezierLine } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import type { Mesh } from 'three';
import type { Orders } from '../protocol/orders';
import { Board, type Hex } from '../protocol/hex';
import { seatColor } from './palette';
import type { TileVis } from './tiles';

const at = (tiles: TileVis[], board: Board, h: Hex): [number, number, number] | null => {
  const i = board.index(h);
  return i == null ? null : tiles[i].pos;
};

export function TroopChips({ tiles, me }: { tiles: TileVis[]; me: number | null }) {
  return (
    <>
      {tiles
        .filter((t) => t.sight === 'visible' && t.troops > 0)
        .map((t) => (
          <Html key={t.index} position={[t.pos[0], t.pos[1] + 1.05, t.pos[2]]} center distanceFactor={14} zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
            <div className={`chip ${t.owner === me ? 'mine' : ''}`} style={{ ['--c' as string]: seatColor(t.owner) }}>
              {t.troops}
              {t.fort ? <span className="fort">◆</span> : null}
            </div>
          </Html>
        ))}
    </>
  );
}

export function OrderArcs({ tiles, board, orders, color, solid }: { tiles: TileVis[]; board: Board; orders: Orders; color: string; solid?: boolean }) {
  return (
    <>
      {orders.moves.map((m, k) => {
        const a = at(tiles, board, m.from), b = at(tiles, board, m.to);
        if (!a || !b) return null;
        const mid: [number, number, number] = [(a[0] + b[0]) / 2, Math.max(a[1], b[1]) + 1.4, (a[2] + b[2]) / 2];
        return (
          <group key={k}>
            <QuadraticBezierLine start={[a[0], a[1] + 0.3, a[2]]} end={[b[0], b[1] + 0.3, b[2]]} mid={mid} color={color} lineWidth={3} dashed={!solid} dashSize={0.25} gapSize={0.15} />
            <Html position={[mid[0], mid[1] - 0.35, mid[2]]} center distanceFactor={14} style={{ pointerEvents: 'none' }}>
              <div className="arc-label" style={{ ['--c' as string]: color }}>{m.count}</div>
            </Html>
          </group>
        );
      })}
      {orders.scout && orders.scout.length > 0 && (
        <ScoutPath tiles={tiles} board={board} path={orders.scout} color={color} />
      )}
    </>
  );
}

function ScoutPath({ tiles, board, path, color }: { tiles: TileVis[]; board: Board; path: Hex[]; color: string }) {
  const pts = path.map((h) => at(tiles, board, h)).filter(Boolean) as [number, number, number][];
  return (
    <>
      {pts.slice(1).map((b, k) => {
        const a = pts[k];
        return <QuadraticBezierLine key={k} start={[a[0], a[1] + 1.6, a[2]]} end={[b[0], b[1] + 1.6, b[2]]} mid={[(a[0] + b[0]) / 2, Math.max(a[1], b[1]) + 2, (a[2] + b[2]) / 2]} color={color} lineWidth={1.5} dashed dashSize={0.08} gapSize={0.12} />;
      })}
      {pts.map((p, k) => (
        <Html key={`s${k}`} position={[p[0], p[1] + 1.7, p[2]]} center distanceFactor={14} style={{ pointerEvents: 'none' }}>
          <div className="scout-dot">{k + 1}</div>
        </Html>
      ))}
    </>
  );
}

export function Ring({ pos, color, pulse, radius = 0.98 }: { pos: [number, number, number]; color: string; pulse?: boolean; radius?: number }) {
  const ref = useRef<Mesh>(null!);
  useFrame(({ clock }) => {
    if (!pulse) return;
    const s = 1 + Math.sin(clock.elapsedTime * 5) * 0.08;
    ref.current.scale.set(s, s, 1);
  });
  return (
    <mesh ref={ref} position={[pos[0], pos[1] + 0.2, pos[2]]} rotation={[-Math.PI / 2, 0, Math.PI / 6]}>
      <ringGeometry args={[radius - 0.07, radius, 6]} />
      <meshBasicMaterial color={color} toneMapped={false} transparent opacity={0.95} />
    </mesh>
  );
}

export function BattleMarks({ tiles, board, battles }: { tiles: TileVis[]; board: Board; battles: Hex[] }) {
  return (
    <>
      {battles.map((h, k) => {
        const p = at(tiles, board, h);
        if (!p) return null;
        return (
          <group key={k}>
            <Ring pos={p} color="#ff4d4d" pulse radius={1.08} />
            <Html position={[p[0], p[1] + 1.9, p[2]]} center distanceFactor={14} style={{ pointerEvents: 'none' }}>
              <div className="battle-tag">⚔</div>
            </Html>
          </group>
        );
      })}
    </>
  );
}

export function RumoredCapitals({ tiles, board, capitals, alive, me }: { tiles: TileVis[]; board: Board; capitals: Hex[]; alive: boolean[]; me: number }) {
  return (
    <>
      {capitals.map((h, k) => {
        if (k === me || !alive[k]) return null;
        const i = board.index(h);
        if (i == null || tiles[i].sight === 'visible') return null;
        const p = tiles[i].pos;
        return (
          <Html key={k} position={[p[0], 1.9, p[2]]} center distanceFactor={14} style={{ pointerEvents: 'none' }}>
            <div className="rumor" style={{ ['--c' as string]: seatColor(k) }} title="Capitals follow an open placement rule, so their positions are public. The armies are not.">♜</div>
          </Html>
        );
      })}
    </>
  );
}
