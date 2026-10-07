// ============================================================
// KodyUno — Board registry
// ============================================================
import type { BoardDef, BoardId, BoardPin } from './types'
import { BOARD_SCALE } from './types'
import { ARDUINO_MEGA, ARDUINO_NANO, ARDUINO_UNO } from './avr'
import { ESP32_C3, ESP32_C6, ESP32_DEVKIT_V1, ESP32_S2, ESP32_S3 } from './esp32'
import { ESP8266_NODEMCU } from './esp8266'

export * from './types'

export const BOARDS: Record<BoardId, BoardDef> = {
  uno: ARDUINO_UNO,
  nano: ARDUINO_NANO,
  mega: ARDUINO_MEGA,
  esp32: ESP32_DEVKIT_V1,
  'esp32-s3': ESP32_S3,
  'esp32-s2': ESP32_S2,
  'esp32-c3': ESP32_C3,
  'esp32-c6': ESP32_C6,
  esp8266: ESP8266_NODEMCU,
}

/** Picker order: Arduino first, then the ESP line-up. */
export const BOARD_ORDER: BoardId[] = [
  'uno',
  'nano',
  'mega',
  'esp32',
  'esp32-s3',
  'esp32-s2',
  'esp32-c3',
  'esp32-c6',
  'esp8266',
]

export const BOARD_LIST: BoardDef[] = BOARD_ORDER.map((id) => BOARDS[id])

export function getBoard(id: BoardId): BoardDef {
  return BOARDS[id] ?? BOARDS.uno
}

/** Board placement on the simulator canvas, in canvas units. */
export const BOARD_X = 80
export const BOARD_Y = 10

export interface BoardHole extends BoardPin {
  /** Canvas-space position of the header hole. */
  cx: number
  cy: number
}

/** Header holes of a board in canvas coordinates. */
export function boardHoles(board: BoardDef): BoardHole[] {
  return board.pins.map((pin) => ({
    ...pin,
    cx: BOARD_X + pin.x * BOARD_SCALE,
    cy: BOARD_Y + pin.y * BOARD_SCALE,
  }))
}

/** Board artwork size in canvas units. */
export function boardSize(board: BoardDef): { w: number; h: number } {
  return {
    w: board.artwork.cssW * BOARD_SCALE,
    h: board.artwork.cssH * BOARD_SCALE,
  }
}
