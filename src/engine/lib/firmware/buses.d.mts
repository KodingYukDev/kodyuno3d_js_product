import type * as AVR from 'avr8js'
import type { Hardware } from '../cpp/hardware'
import type { AvrBoard } from './avrBoard.mjs'
export function attachUnoBuses(avr: typeof AVR, uno: AvrBoard, hardware: Hardware, syncPins?: () => void, trace?: (event: { bus: string; operation: string; start: number; end: number; cycles: number }) => void, route?: (value: number) => number | undefined): { spi: AVR.AVRSPI; twi: AVR.AVRTWI }
