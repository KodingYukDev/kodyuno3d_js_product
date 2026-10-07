import type * as AVR from 'avr8js'
import type { AvrBoard } from './avrBoard.mjs'
export function parseUnoHex(text: string): Uint16Array
export function createUno(avr: typeof AVR, hex: string, callbacks?: {
  onUart?: (event: { byte: number; cycle: number }) => void
  onGpio?: (event: { port: string; value: number; previous: number; cycle: number }) => void
  readAnalogVoltage?: (channel: number) => number
  eeprom?: Uint8Array
}): AvrBoard & { ports: Record<'B' | 'C' | 'D', AVR.AVRIOPort> }
