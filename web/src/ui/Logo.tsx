// The title treatment: a carved wooden plank with bevelled gold letters, a cracked stone
// plaque beneath, leaves and flying debris. Pure SVG + CSS so it stays crisp and animates.

export const TITLE = { top: 'VEIL', link: 'of the', bottom: 'CLOUDS' };

function Leaf({ x, y, r, s = 1, hue = 0 }: { x: string; y: string; r: number; s?: number; hue?: number }) {
  return (
    <svg className="leaf" viewBox="0 0 60 40" style={{ left: x, top: y, transform: `rotate(${r}deg) scale(${s})`, filter: `hue-rotate(${hue}deg)` }} aria-hidden>
      <defs>
        <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#9be05a" />
          <stop offset="1" stopColor="#3f8a2c" />
        </linearGradient>
      </defs>
      <path d="M2 20 C 14 2, 40 0, 58 20 C 40 40, 14 38, 2 20 Z" fill="url(#lg)" stroke="#2c6620" strokeWidth="1.5" />
      <path d="M4 20 L 54 20" stroke="#2c6620" strokeWidth="1.6" fill="none" />
      <path d="M18 20 L 26 11 M30 20 L 38 11 M18 20 L 26 29 M30 20 L 38 29" stroke="#2c6620" strokeWidth="1" opacity="0.6" />
    </svg>
  );
}

function Plank() {
  return (
    <svg className="plank" viewBox="0 0 1000 300" preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id="wood" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#b77a46" />
          <stop offset="0.5" stopColor="#9c6136" />
          <stop offset="1" stopColor="#7c4626" />
        </linearGradient>
      </defs>
      {/* Two boards, jagged ends, a split on the right */}
      <path d="M40 30 L 70 8 L 520 18 L 560 4 L 970 22 L 990 70 L 960 150 L 40 150 L 18 90 Z" fill="url(#wood)" stroke="#4f2a14" strokeWidth="6" />
      <path d="M30 152 L 960 150 L 985 200 L 965 280 L 600 268 L 560 292 L 60 280 L 12 230 Z" fill="url(#wood)" stroke="#4f2a14" strokeWidth="6" />
      <g stroke="#6b3a1d" strokeWidth="3" fill="none" opacity="0.55">
        <path d="M80 60 C 300 50, 500 75, 940 55" />
        <path d="M70 105 C 260 120, 600 95, 930 115" />
        <path d="M60 200 C 300 190, 650 215, 950 195" />
        <path d="M70 245 C 330 255, 600 236, 940 250" />
        <path d="M820 152 L 850 190 L 835 230" strokeWidth="4" />
        <path d="M200 30 L 230 70" strokeWidth="4" />
      </g>
      <g stroke="#e3a66d" strokeWidth="3" fill="none" opacity="0.35">
        <path d="M80 20 L 520 28" />
        <path d="M50 160 L 950 158" />
      </g>
      {[[70, 50], [930, 60], [70, 240], [930, 240]].map(([cx, cy], k) => (
        <g key={k}>
          <circle cx={cx} cy={cy} r="11" fill="#5d5552" stroke="#2f2826" strokeWidth="3" />
          <circle cx={cx - 3} cy={cy - 3} r="3.5" fill="#a49b96" />
        </g>
      ))}
    </svg>
  );
}

function Slab() {
  return (
    <svg className="slab" viewBox="0 0 1000 260" preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id="stone" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e2d8cb" />
          <stop offset="1" stopColor="#b3a796" />
        </linearGradient>
      </defs>
      <path d="M60 30 L 130 6 L 480 16 L 520 0 L 880 12 L 950 40 L 992 130 L 950 210 L 610 228 L 500 258 L 390 228 L 60 214 L 8 130 Z" fill="url(#stone)" stroke="#5b5148" strokeWidth="7" />
      <path d="M70 40 L 130 18 L 480 28 L 520 12 L 875 24 L 935 48" stroke="#f6f0e6" strokeWidth="5" fill="none" opacity="0.7" />
      <g stroke="#8b8072" strokeWidth="3" fill="none" opacity="0.8">
        <path d="M300 16 L 320 70 L 290 120" />
        <path d="M720 214 L 700 170 L 730 130" />
        <path d="M120 150 L 170 170" />
        <path d="M880 90 L 930 100" />
      </g>
    </svg>
  );
}

const DEBRIS = Array.from({ length: 16 }, (_, k) => ({
  left: `${(k * 61) % 100}%`,
  top: `${(k * 37 + 11) % 100}%`,
  rot: (k * 47) % 360,
  wood: k % 3 === 0,
  size: 8 + ((k * 13) % 14),
  delay: (k % 7) * 0.4,
}));

export function Logo() {
  return (
    <div className="logo" role="img" aria-label={`${TITLE.top} ${TITLE.link} ${TITLE.bottom}`}>
      <div className="debris" aria-hidden>
        {DEBRIS.map((d, k) => (
          <i key={k} className={d.wood ? 'chip wood' : 'chip stone'} style={{ left: d.left, top: d.top, width: d.size, height: d.size * (d.wood ? 0.45 : 0.8), transform: `rotate(${d.rot}deg)`, animationDelay: `${d.delay}s` }} />
        ))}
      </div>
      <div className="logo-plank">
        <Plank />
        <span className="gold" data-text={TITLE.top}>{TITLE.top}</span>
        <Leaf x="-4%" y="62%" r={-30} s={1.3} />
        <Leaf x="91%" y="76%" r={160} s={1.05} hue={-10} />
      </div>
      <div className="logo-link">{TITLE.link}</div>
      <div className="logo-slab">
        <Slab />
        <span className="carved">{TITLE.bottom}</span>
        <Leaf x="-7%" y="10%" r={-160} s={1.1} hue={8} />
        <Leaf x="92%" y="2%" r={-20} s={1.25} />
        <Leaf x="70%" y="82%" r={60} s={0.8} hue={-6} />
      </div>
    </div>
  );
}
