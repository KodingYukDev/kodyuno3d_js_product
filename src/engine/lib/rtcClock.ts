/** Battery-backed wall clock. Calendar values use UTC, independent of host TZ. */
export function rtcEpoch(state: Record<string, unknown>, nowMs = Date.now()): number {
  const epoch = Number(state.epoch)
  if (!Number.isFinite(epoch) || epoch <= 0) return Math.floor(nowMs / 1000)
  const anchor = Number(state.epochSetAt)
  // Legacy projects specify a fixed epoch without an elapsed-time anchor.
  if (!Number.isFinite(anchor) || anchor <= 0) return Math.floor(epoch)
  return Math.floor(epoch + Math.max(0, nowMs - anchor) / 1000)
}
