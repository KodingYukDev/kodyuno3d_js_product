import { useId } from 'react'
import type { BoardDef } from '@kodyuno/lib/boards'

/** Original LoLin-inspired artwork. Coordinates retain existing project wiring. */
export function LolinBoard({ board, ledOn }: { board: BoardDef; ledOn: boolean }) {
  const id = useId().replace(/:/g, '')
  const { cssW: w, cssH: h } = board.artwork
  const cx = w / 2
  return <g aria-label="LoLin NodeMCU V3 ESP8266 / CH340">
    <defs>
      <linearGradient id={`${id}-metal`} x2="1" y2="1">
        <stop stopColor="#f1f3f4" /><stop offset=".45" stopColor="#a8adb0" /><stop offset=".7" stopColor="#e4e6e7" /><stop offset="1" stopColor="#878d92" />
      </linearGradient>
    </defs>
    <rect width={w} height={h} rx="5" fill="#191d22" stroke="#42474c" />
    {[8, w - 8].flatMap(x => [8, h - 8].map(y => <g key={`${x}-${y}`}>
      <circle cx={x} cy={y} r="3.6" fill="#b6a477" /><circle cx={x} cy={y} r="2.2" fill="#e2e8f0" />
    </g>))}
    <rect x={cx - 26} y="14" width="52" height="89" rx="1" fill="#30323a" stroke="#a88946" strokeWidth=".7" />
    <path d={`M${cx - 22} 36 V19 H${cx - 15} V32 H${cx - 8} V19 H${cx - 1} V32 H${cx + 6} V19 H${cx + 13} V32 H${cx + 21} V17`} fill="none" stroke="#c2aa67" strokeWidth="2" />
    {Array.from({ length: 8 }, (_, i) => <g key={i} fill="#c2aa67">
      <rect x={cx - 28} y={41 + i * 7.4} width="4" height="3.5" /><rect x={cx + 24} y={41 + i * 7.4} width="4" height="3.5" />
    </g>)}
    <rect x={cx - 23} y="39" width="46" height="61" rx="2" fill={`url(#${id}-metal)`} stroke="#737b80" />
    <g textAnchor="middle" fill="#41474a" fontFamily="Arial, sans-serif">
      <text x={cx} y="55" fontSize="7" fontWeight="bold">ESP8266MOD</text>
      <text x={cx} y="66" fontSize="5">AI-THINKER</text>
      <text x={cx} y="77" fontSize="5">ISM 2.4GHz</text>
      <text x={cx} y="93" fontSize="10">CE</text>
    </g>
    <g fill="#c6c8c9">
      {Array.from({ length: 8 }, (_, i) => <g key={i}>
        <rect x={cx - 16} y={125 + i * 3.2} width="5" height="1.5" /><rect x={cx + 11} y={125 + i * 3.2} width="5" height="1.5" />
      </g>)}
    </g>
    <rect x={cx - 11} y="122" width="22" height="29" rx="1" fill="#0b0c0e" stroke="#494b4e" />
    <text x={cx} y="139" textAnchor="middle" fontSize="5" fill="#b1b4b6">CH340G</text>
    <rect x={cx - 8} y="108" width="16" height="8" rx="3" fill={`url(#${id}-metal)`} />
    {[-1, 1].map(side => <g key={side}>
      <rect x={cx + side * 24 - 6} y={h - 47} width="12" height="12" rx="1" fill="#c0c2c5" />
      <circle cx={cx + side * 24} cy={h - 41} r="3.8" fill="#252729" />
      <text x={cx + side * 24} y={h - 28} textAnchor="middle" fontSize="5" fill="#f1f1e9">{side < 0 ? 'RST' : 'FLASH'}</text>
    </g>)}
    <rect x={cx - 15} y={h - 24} width="30" height="25" rx="2" fill={`url(#${id}-metal)`} stroke="#7f878e" />
    <path d={`M${cx - 11} ${h - 1} v-6 h22 v6 Z`} fill="#292d31" />
    <rect x={cx - 7} y={h - 5} width="14" height="2" fill="#8a8170" />
    <text x={cx} y={h - 53} textAnchor="middle" fontSize="8" fontWeight="bold" fill="#f3f1e6">LoLin</text>
    <rect x={cx + 17} y="104" width="4" height="3" fill={ledOn ? '#38bdf8' : '#545d62'} />
    {ledOn && <circle cx={cx + 19} cy="105.5" r="6" fill="#38bdf8" opacity=".4" />}
    {board.pins.map(pin => <g key={pin.id}>
      <rect x={pin.x - 3.5} y={pin.y - 3.5} width="7" height="7" rx="1" fill="#b29a61" />
      <circle cx={pin.x} cy={pin.y} r="1.8" fill="#0c1015" stroke="#eadcb2" strokeWidth=".4" />
      <text x={pin.x < cx ? pin.x + 6 : pin.x - 6} y={pin.y + 1.5} textAnchor={pin.x < cx ? 'start' : 'end'} fontSize="4.2" fill="#f2f0e8" fontFamily="monospace">{pin.label}</text>
    </g>)}
  </g>
}
