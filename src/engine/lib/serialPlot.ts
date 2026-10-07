// Serial Plotter parsing, following the Arduino IDE 2 format:
//   Serial.println(value)                  → one series
//   Serial.print(a); Serial.print(" "); Serial.println(b)   → several series
//   "suhu:23.5,lembap:60"                  → labelled series
// Values may be separated by spaces, tabs or commas. A line with any
// non-numeric, unlabelled token is text, not data, and is skipped.

export interface PlotSample { label: string; value: number }

export function parsePlotLine(line: string): PlotSample[] | null {
  const tokens = line.trim().split(/[\s,]+/).filter(Boolean)
  if (!tokens.length) return null
  const samples: PlotSample[] = []
  for (const [position, token] of tokens.entries()) {
    const colon = token.lastIndexOf(':')
    const label = colon > 0 ? token.slice(0, colon) : `nilai ${position + 1}`
    const raw = colon > 0 ? token.slice(colon + 1) : token
    if (!/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(raw)) return null
    samples.push({ label, value: Number(raw) })
  }
  return samples
}

export interface PlotSeries { label: string; values: (number | null)[] }

/** Last `window` data lines as aligned series (missing values are null). */
export function buildPlot(lines: string[], window = 200): { series: PlotSeries[]; length: number } {
  const rows = lines.map(line => parsePlotLine(line)).filter((row): row is PlotSample[] => row !== null).slice(-window)
  const labels: string[] = []
  for (const row of rows) for (const { label } of row) if (!labels.includes(label)) labels.push(label)
  const series = labels.slice(0, 8).map(label => ({
    label,
    values: rows.map(row => row.find(sample => sample.label === label)?.value ?? null),
  }))
  return { series, length: rows.length }
}
