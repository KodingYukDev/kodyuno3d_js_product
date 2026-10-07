/** ISO14443-A UID lengths: single, double and triple size. */
export function parseRfidUid(value: unknown): number[] | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  const tokens = /^[0-9a-f]+$/i.test(trimmed)
    ? trimmed.match(/.{1,2}/g) ?? []
    : trimmed.split(/[\s:-]+/)
  if (![4, 7, 10].includes(tokens.length) || tokens.some(token => !/^[0-9a-f]{2}$/i.test(token))) return null
  return tokens.map(token => Number.parseInt(token, 16))
}
