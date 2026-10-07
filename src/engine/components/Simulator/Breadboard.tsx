import { BB_BODY, BB_HOLES, BB_ROW_Y, BB_X0, BB_PITCH, BB_COLS } from '@kodyuno/lib/breadboard'

// Visual breadboard. Holes are drawn here; the canvas overlays the
// interactive hit-targets and net highlighting.

interface Props {
  /** net root currently highlighted while wiring (all its holes glow) */
  highlightNet?: string | null
  /** node key → net root map from the solver */
  netOf?: Record<string, string>
}

export function BreadboardGraphic({ highlightNet, netOf }: Props) {
  const railXEnd = BB_X0 + (BB_COLS - 1) * BB_PITCH
  return (
    <g>
      {/* body */}
      <rect x={BB_BODY.x} y={BB_BODY.y} width={BB_BODY.w} height={BB_BODY.h} rx="8"
        fill="#f2ede3" stroke="#c9c0ae" strokeWidth="1.5" />
      {/* center channel */}
      <rect x={BB_BODY.x} y={583} width={BB_BODY.w} height={14} fill="#e2dbcc" />
      <path d={`M${BB_BODY.x} 583 H${BB_BODY.x + BB_BODY.w}`} stroke="#cfc6b2" strokeWidth="1" />
      <path d={`M${BB_BODY.x} 597 H${BB_BODY.x + BB_BODY.w}`} stroke="#cfc6b2" strokeWidth="1" />

      {/* rail markings */}
      <path d={`M${BB_X0 - 8} 466 H${railXEnd + 8}`} stroke="#dc2626" strokeWidth="1.6" />
      <path d={`M${BB_X0 - 8} 498 H${railXEnd + 8}`} stroke="#2563eb" strokeWidth="1.6" />
      <path d={`M${BB_X0 - 8} 674 H${railXEnd + 8}`} stroke="#2563eb" strokeWidth="1.6" />
      <path d={`M${BB_X0 - 8} 706 H${railXEnd + 8}`} stroke="#dc2626" strokeWidth="1.6" />
      <text x={BB_BODY.x + 6} y={478} fontSize="9" fill="#dc2626" fontWeight="bold">+</text>
      <text x={BB_BODY.x + 6} y={494} fontSize="9" fill="#2563eb" fontWeight="bold">−</text>
      <text x={BB_BODY.x + 6} y={686} fontSize="9" fill="#2563eb" fontWeight="bold">−</text>
      <text x={BB_BODY.x + 6} y={702} fontSize="9" fill="#dc2626" fontWeight="bold">+</text>

      {/* row labels a–j */}
      {(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'] as const).map((row) => (
        <text key={row} x={BB_BODY.x + 5} y={BB_ROW_Y[row] + 3} fontSize="7" fill="#a39a85" fontFamily="monospace">{row}</text>
      ))}
      {/* column numbers every 5 */}
      {Array.from({ length: BB_COLS }).map((_, col) =>
        (col + 1) % 5 === 0 || col === 0 ? (
          <text key={col} x={BB_X0 + col * BB_PITCH} y={512} fontSize="6.5" fill="#a39a85" textAnchor="middle" fontFamily="monospace">
            {col + 1}
          </text>
        ) : null
      )}

      {/* holes */}
      {BB_HOLES.map((h) => {
        const hot = highlightNet && netOf && netOf[h.net] === highlightNet
        return (
          <g key={h.id}>
            {hot && <rect x={h.x - 5} y={h.y - 5} width="10" height="10" rx="2" fill="#4ade80" opacity="0.55" />}
            <rect x={h.x - 3.2} y={h.y - 3.2} width="6.4" height="6.4" rx="1.4" fill="#3f3f46" />
            <rect x={h.x - 1.8} y={h.y - 1.8} width="3.6" height="3.6" rx="1" fill="#18181b" />
          </g>
        )
      })}
    </g>
  )
}
