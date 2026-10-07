// ============================================================
// KodyUno — SVG Icon Library
// Clean line/solid icons, no emoji. 24x24 viewBox, currentColor.
// ============================================================
import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function base({ size = 20, ...props }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    ...props,
  }
}

// ---- UI / Controls ----

export const PlayIcon = (p: IconProps) => (
  <svg {...base(p)} fill="currentColor" stroke="none"><path d="M8 5.14v13.72a1 1 0 0 0 1.5.86l11-6.86a1 1 0 0 0 0-1.72l-11-6.86A1 1 0 0 0 8 5.14z" /></svg>
)

export const StopIcon = (p: IconProps) => (
  <svg {...base(p)} fill="currentColor" stroke="none"><rect x="5" y="5" width="14" height="14" rx="2.5" /></svg>
)

export const CheckIcon = (p: IconProps) => (
  <svg {...base(p)}><path d="M20 6 9 17l-5-5" /></svg>
)

export const ChevronRightIcon = (p: IconProps) => (
  <svg {...base(p)}><path d="m9 18 6-6-6-6" /></svg>
)

export const ArrowLeftIcon = (p: IconProps) => (
  <svg {...base(p)}><path d="M19 12H5" /><path d="m12 19-7-7 7-7" /></svg>
)

export const MenuIcon = (p: IconProps) => (
  <svg {...base(p)}><path d="M4 6h16M4 12h16M4 18h16" /></svg>
)

export const CloseIcon = (p: IconProps) => (
  <svg {...base(p)}><path d="M18 6 6 18M6 6l12 12" /></svg>
)

export const RefreshIcon = (p: IconProps) => (
  <svg {...base(p)}><path d="M3 12a9 9 0 0 1 15-6.7L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-15 6.7L3 16" /><path d="M3 21v-5h5" /></svg>
)

export const CopyIcon = (p: IconProps) => (
  <svg {...base(p)}><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
)

export const TrashIcon = (p: IconProps) => (
  <svg {...base(p)}><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
)

export const BulbIcon = (p: IconProps) => (
  <svg {...base(p)}><path d="M9 18h6M10 22h4" /><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14" /></svg>
)

// ---- Tab icons ----

export const TargetIcon = (p: IconProps) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.5" fill="currentColor" /></svg>
)

export const ChipIcon = (p: IconProps) => (
  <svg {...base(p)}><rect x="6" y="6" width="12" height="12" rx="1.5" /><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" /><rect x="9.5" y="9.5" width="5" height="5" rx="0.5" /></svg>
)

export const CodeIcon = (p: IconProps) => (
  <svg {...base(p)}><path d="m16 18 6-6-6-6M8 6l-6 6 6 6" /></svg>
)

export const TerminalIcon = (p: IconProps) => (
  <svg {...base(p)}><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m6 9 3 3-3 3M12 15h5" /></svg>
)

// ---- Component icons (for palette) — schematic style ----

export const LedComponentIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 3a5 5 0 0 0-5 5v5h10V8a5 5 0 0 0-5-5Z" />
    <path d="M7 13h10v2H7z" />
    <path d="M9 17v3M15 17v3" />
    <path d="M10.5 8.5 12 7l1.5 1.5" strokeWidth="1.4" />
  </svg>
)

export const BuzzerComponentIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="11" r="7" />
    <circle cx="12" cy="11" r="1.5" fill="currentColor" />
    <path d="M10 18v3M14 18v3" />
  </svg>
)

export const ServoComponentIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="5" y="8" width="14" height="10" rx="1" />
    <circle cx="9" cy="6" r="2.5" />
    <path d="M9 6 4 4" strokeWidth="1.6" />
    <path d="M12 18v3M16 18v3" strokeWidth="1.4" />
  </svg>
)

export const LcdComponentIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="3" y="6" width="18" height="12" rx="1.5" />
    <rect x="6" y="9" width="12" height="6" rx="0.5" />
    <path d="M8 11h2M12 11h4M8 13h6" strokeWidth="1.2" />
  </svg>
)

export const DhtComponentIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 14.5V5a2 2 0 0 0-4 0v9.5a4 4 0 1 0 4 0Z" transform="translate(2 0)" />
    <circle cx="12" cy="16.5" r="1.6" fill="currentColor" stroke="none" />
  </svg>
)

export const UltrasonicComponentIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="3" y="7" width="18" height="10" rx="1.5" />
    <circle cx="8" cy="12" r="2.5" />
    <circle cx="16" cy="12" r="2.5" />
  </svg>
)

export const PirComponentIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="8" />
    <path d="M12 12a5 5 0 0 1 5-5M12 12a5 5 0 0 0-5 5" strokeWidth="1.4" />
    <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
  </svg>
)

export const SpeedSlowIcon = (p: IconProps) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
)

export const SpeedFastIcon = (p: IconProps) => (
  <svg {...base(p)} fill="currentColor" stroke="none"><path d="M13 2 4.5 13.5H11l-1 8.5L19.5 10H13l0-8z" /></svg>
)
