/** Decorative only: shares the measured board centre without changing seats. */
export function RitualCircle({ diameter, offsetY, offsetX = 0 }: { diameter: number; offsetY: number; offsetX?: number }) {
  const point = (index: number, radius: number, count: number, start = 0) => {
    const angle = start + index * Math.PI * 2 / count;
    return { x: 100 + Math.cos(angle) * radius, y: 100 + Math.sin(angle) * radius };
  };
  const star = Array.from({ length: 7 }, (_, i) => {
    const p = point(i * 3, 78, 7, -Math.PI / 2);
    return `${p.x},${p.y}`;
  }).join(" ");
  return <div className="ritual-circle" aria-hidden="true" style={{ width: diameter, height: diameter, marginTop: offsetY, marginLeft: offsetX }}>
    <div className="ritual-circle-glow" />
    <svg className="ritual-circle-dial" viewBox="0 0 200 200" focusable="false">
      <g fill="none" stroke="rgba(232,199,122,.32)" strokeWidth=".35">
        <circle cx="100" cy="100" r="98" /><circle cx="100" cy="100" r="96" />
        {Array.from({ length: 72 }, (_, i) => {
          const outer = point(i, 96, 72);
          const inner = point(i, i % 6 === 0 ? 89 : 93, 72);
          return <line key={i} x1={outer.x} y1={outer.y} x2={inner.x} y2={inner.y} />;
        })}
        <circle cx="100" cy="100" r="84" stroke="rgba(232,199,122,.18)" />
        {Array.from({ length: 7 }, (_, i) => {
          const p = point(i, 84, 7, -Math.PI / 2);
          return <rect key={i} x={p.x - 2.2} y={p.y - 2.2} width="4.4" height="4.4" transform={`rotate(45 ${p.x} ${p.y})`} fill="rgba(232,199,122,.55)" stroke="none" />;
        })}
      </g>
    </svg>
    <svg className="ritual-circle-star" viewBox="0 0 200 200" focusable="false">
      <g fill="none" stroke="rgba(190,160,235,.2)" strokeWidth=".35">
        <polygon points={star} />
        <circle cx="100" cy="100" r="78" stroke="rgba(232,199,122,.16)" />
        <circle cx="100" cy="100" r="46" strokeDasharray="1 2.5" stroke="rgba(232,199,122,.22)" />
      </g>
    </svg>
  </div>;
}
