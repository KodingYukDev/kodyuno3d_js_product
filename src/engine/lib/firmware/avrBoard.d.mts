import type * as AVR from 'avr8js'
export interface AvrProfile {
  id: 'uno' | 'nano' | 'mega'
  flashBytes: number
  sramBytes: number
  eepromBytes: number
  pins: Array<[string, number]>
  ports: Record<string, unknown>
  analogBase: number
  analogChannels: number
  spi: { mosi: number; miso: number; sck: number; ss: number }
  twi: { sda: number; scl: number }
  spiConfig: AVR.SPIConfig
  twiConfig: AVR.TWIConfig
}
export interface AvrBoard {
  cpu: AVR.CPU
  ports: Record<string, AVR.AVRIOPort>
  uart: AVR.AVRUSART
  adc: AVR.AVRADC
  timers: AVR.AVRTimer[]
  eepromMemory: Uint8Array
  frequency: number
  profile: AvrProfile
  portPins: Record<string, number[]>
  pinCount: number
  pinId(pin: number): number | string
  portOf(pin: number): [string, number]
  pinState(pin: number): AVR.PinState
  portLatch(pin: number): number
  isOutput(pin: number): number
  inputLevel(pin: number): number
  readPwm(): Map<number, number>
  setDigitalInput(pin: number, high: boolean): void
  runCycles(budget: number): number
  stop(): void
}
export function avrProfile(avr: typeof AVR, boardId: string): AvrProfile | null
export function parseIntelHex(text: string, flashBytes: number): Uint16Array
export function createAvrBoard(avr: typeof AVR, hex: string, profile: AvrProfile, callbacks?: {
  onUart?: (event: { byte: number; cycle: number }) => void
  onGpio?: (event: { port: string; value: number; previous: number; cycle: number }) => void
  readAnalogVoltage?: (channel: number) => number
  eeprom?: Uint8Array
}): AvrBoard
