// ============================================================
// KodyUno — Generic devkit artwork
//
// KodyUno's own board drawing, used for every devkit we render ourselves
// (ESP32-S3 / S2 / C3 / C6, NodeMCU ESP8266). It is driven entirely by the
// BoardDef: header pads are placed on the pin coordinates, so wire targets
// and artwork can never drift apart.
//
// Everything is plain SVG in CSS-pixel space; the caller scales it into
// canvas units.
// ============================================================
import type { BoardDef, BoardPin, GenericBoardTheme } from '@kodyuno/lib/boards'

const PAD = 7.2
const PAD_R = 2.6

function padFill(pin: BoardPin): string {
  switch (pin.kind) {
    case 'gnd': return '#1f2937'
    case 'power': return '#b91c1c'
    case 'analog': return '#0e7490'
    case 'special': return '#6b7280'
    default: return '#b8860b'
  }
}

function HeaderPad({ pin, side, silk }: { pin: BoardPin; side: 'left' | 'right'; silk: string }) {
  const labelX = side === 'left' ? pin.x + PAD / 2 + 3 : pin.x - PAD / 2 - 3
  return (
    <g>
      <rect
        x={pin.x - PAD / 2}
        y={pin.y - PAD / 2}
        width={PAD}
        height={PAD}
        rx={PAD_R}
        fill={padFill(pin)}
        stroke="#0b1220"
        strokeWidth="0.5"
      />
      <circle cx={pin.x} cy={pin.y} r="1.7" fill="#0b1220" opacity="0.75" />
      <text
        x={labelX}
        y={pin.y + 1.9}
        fontSize="5.2"
        fontFamily="ui-monospace, monospace"
        fill={silk}
        textAnchor={side === 'left' ? 'start' : 'end'}
      >
        {pin.label}
      </text>
    </g>
  )
}

function UsbSocket({ x, y, kind }: { x: number; y: number; kind: GenericBoardTheme['usb'] }) {
  const w = kind === 'usb-c' ? 17 : 20
  const h = kind === 'usb-c' ? 8 : 9
  return (
    <g>
      <rect x={x - w / 2} y={y} width={w} height={h} rx={kind === 'usb-c' ? 4 : 1.5} fill="#94a3b8" stroke="#475569" strokeWidth="0.6" />
      <rect x={x - w / 2 + 2.4} y={y + 2} width={w - 4.8} height={h - 4} rx={kind === 'usb-c' ? 2 : 0.8} fill="#334155" />
    </g>
  )
}

function ShieldCan({ x, y, w, h, theme }: { x: number; y: number; w: number; h: number; theme: GenericBoardTheme }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx="2.5" fill={theme.shield} stroke="#7c848f" strokeWidth="0.8" />
      {/* stamped grid so the can does not read as a flat rectangle */}
      {Array.from({ length: Math.floor(h / 7) }).map((_, row) => (
        <line key={row} x1={x + 3} y1={y + 6 + row * 7} x2={x + w - 3} y2={y + 6 + row * 7} stroke="#a9b0b8" strokeWidth="0.4" />
      ))}
      <rect x={x + 4} y={y + h - 22} width={w - 8} height="13" rx="1.5" fill="#8d949c" opacity="0.55" />
      <text x={x + w / 2} y={y + h - 13} fontSize="4.6" fontFamily="ui-monospace, monospace" fill="#1f2937" textAnchor="middle">
        {theme.moduleLabel}
      </text>
    </g>
  )
}

function BoardLed({ x, y, on, color }: { x: number; y: number; on: boolean; color: string }) {
  return (
    <g>
      {on && <circle cx={x} cy={y} r="5.5" fill={color} opacity="0.35" />}
      <rect x={x - 2.6} y={y - 1.8} width="5.2" height="3.6" rx="0.7" fill={on ? color : '#4b5563'} stroke="#1f2937" strokeWidth="0.35" />
    </g>
  )
}

export interface GenericBoardProps {
  board: BoardDef
  /** LED_BUILTIN state — lit when the sketch drives the pin high. */
  ledOn: boolean
  /** Power rail LED, lit while the sketch is running. */
  powerOn: boolean
}

export function GenericBoard({ board, ledOn, powerOn }: GenericBoardProps) {
  if (board.artwork.kind !== 'generic') return null
  const { cssW, cssH, theme } = board.artwork
  const mid = cssW / 2

  const left = board.pins.filter((p) => p.x < mid)
  const right = board.pins.filter((p) => p.x >= mid)
  const headerTop = Math.min(...board.pins.map((p) => p.y))
  const headerBottom = Math.max(...board.pins.map((p) => p.y))

  const shieldW = cssW - 26
  const shieldTop = headerTop + 4
  const shieldH = Math.max(52, (headerBottom - headerTop) * 0.52)

  const usbCount = theme.usbCount ?? 1
  const usbXs = usbCount === 1 ? [mid] : [mid - cssW / 5, mid + cssW / 5]

  return (
    <g>
      {/* ---- PCB ---- */}
      <rect x="0" y="0" width={cssW} height={cssH} rx="5" fill={theme.pcb} />
      <rect x="0.7" y="0.7" width={cssW - 1.4} height={cssH - 1.4} rx="4.4" fill="none" stroke="#000" strokeOpacity="0.35" strokeWidth="1.4" />

      {/* mounting holes */}
      {[
        [7, 7], [cssW - 7, 7], [7, cssH - 7], [cssW - 7, cssH - 7],
      ].map(([hx, hy]) => (
        <g key={`${hx}-${hy}`}>
          <circle cx={hx} cy={hy} r="3.1" fill="#d4d4d8" />
          <circle cx={hx} cy={hy} r="1.7" fill="#111827" />
        </g>
      ))}

      {/* ---- USB + buttons on the top edge ---- */}
      {usbXs.map((ux, i) => (
        <UsbSocket key={i} x={ux} y={-1} kind={theme.usb} />
      ))}
      {(theme.buttons ?? []).map((label, i) => {
        const bx = i === 0 ? 13 : cssW - 13
        const by = headerTop - 16
        return (
          <g key={label}>
            <rect x={bx - 5.5} y={by - 4} width="11" height="8" rx="1.2" fill="#1f2937" stroke="#0b1220" strokeWidth="0.5" />
            <circle cx={bx} cy={by} r="2.4" fill="#e5e7eb" />
            <text x={bx} y={by + 11} fontSize="4" fontFamily="ui-monospace, monospace" fill={theme.silk} textAnchor="middle">
              {label}
            </text>
          </g>
        )
      })}

      {/* ---- RF shield / module can ---- */}
      <ShieldCan x={(cssW - shieldW) / 2} y={shieldTop} w={shieldW} h={shieldH} theme={theme} />

      {/* ---- onboard LEDs ---- */}
      <BoardLed x={mid - 12} y={shieldTop + shieldH + 9} on={powerOn} color="#ef4444" />
      <BoardLed x={mid + 12} y={shieldTop + shieldH + 9} on={ledOn} color="#22d3ee" />
      <text x={mid - 12} y={shieldTop + shieldH + 17} fontSize="3.6" fill={theme.silk} textAnchor="middle" fontFamily="ui-monospace, monospace">PWR</text>
      <text x={mid + 12} y={shieldTop + shieldH + 17} fontSize="3.6" fill={theme.silk} textAnchor="middle" fontFamily="ui-monospace, monospace">
        {board.builtinLed === null ? 'LED' : `IO${board.builtinLed}`}
      </text>

      {/* ---- brand silkscreen ---- */}
      <text
        x={mid}
        y={cssH - 12}
        fontSize="6"
        fontWeight="700"
        fontFamily="ui-monospace, monospace"
        fill={theme.silk}
        textAnchor="middle"
        letterSpacing="1"
      >
        {theme.subLabel}
      </text>
      <text x={mid} y={cssH - 4.5} fontSize="4.2" fontFamily="ui-monospace, monospace" fill={theme.silk} opacity="0.75" textAnchor="middle">
        {board.name}
      </text>

      {/* ---- header strips ---- */}
      {[left, right].map((column, i) => {
        if (column.length === 0) return null
        const x = column[0].x
        const y0 = Math.min(...column.map((p) => p.y))
        const y1 = Math.max(...column.map((p) => p.y))
        return (
          <rect
            key={i}
            x={x - PAD / 2 - 1.2}
            y={y0 - PAD / 2 - 1.2}
            width={PAD + 2.4}
            height={y1 - y0 + PAD + 2.4}
            rx="1.6"
            fill="#0b1220"
            opacity="0.55"
          />
        )
      })}

      {/* ---- header pads ---- */}
      {left.map((pin) => (
        <HeaderPad key={`l-${pin.id}`} pin={pin} side="left" silk={theme.silk} />
      ))}
      {right.map((pin) => (
        <HeaderPad key={`r-${pin.id}`} pin={pin} side="right" silk={theme.silk} />
      ))}
    </g>
  )
}
