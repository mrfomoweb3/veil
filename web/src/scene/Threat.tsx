// Threat view: visible enemy stacks glow red in proportion to their strength.
import type { TileVis } from './tiles';

export function ThreatMarks({ tiles, me }: { tiles: TileVis[]; me: number | null }) {
  const enemies = tiles.filter((t) => t.sight === 'visible' && t.owner != null && t.owner !== me && t.troops > 0);
  const max = Math.max(1, ...enemies.map((t) => t.troops));
  return (
    <>
      {enemies.map((t) => (
        <mesh key={t.index} position={[t.pos[0], t.pos[1] + 0.03, t.pos[2]]} rotation={[-Math.PI / 2, 0, Math.PI / 6]}>
          <circleGeometry args={[0.82, 6]} />
          <meshBasicMaterial color="#ff3b3b" transparent opacity={0.18 + 0.45 * (t.troops / max)} toneMapped={false} depthWrite={false} />
        </mesh>
      ))}
    </>
  );
}
