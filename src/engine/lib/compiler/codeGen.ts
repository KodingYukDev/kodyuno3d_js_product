// Helpers for the Arduino C++ code generator
export const HEADER = `// KodyUno — Generated Arduino Code\n// Jangan edit manual — ubah lewat blok!\n\n`

export function indent(code: string, level = 1): string {
  const prefix = '  '.repeat(level)
  return code
    .split('\n')
    .map((line) => (line.trim() === '' ? '' : prefix + line))
    .join('\n')
}
