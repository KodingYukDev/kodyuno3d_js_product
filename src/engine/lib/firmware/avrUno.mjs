// Uno adapter kept for callers and tests; the board model lives in avrBoard.mjs.
import { avrProfile, createAvrBoard, parseIntelHex } from './avrBoard.mjs'

export function parseUnoHex(text) {
  return parseIntelHex(text, 32768)
}

export function createUno(avr, hex, callbacks = {}) {
  return createAvrBoard(avr, hex, avrProfile(avr, 'uno'), callbacks)
}
