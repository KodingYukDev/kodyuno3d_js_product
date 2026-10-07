/** Arduino core defaults currently modeled. Other variants require explicit pins. */
export type SpiPins = { mosi: number | string; miso: number | string; sck: number | string }
export const DEFAULT_SPI_PINS: Record<string, SpiPins | undefined> = {
  uno: { mosi: 11, miso: 12, sck: 13 }, nano: { mosi: 11, miso: 12, sck: 13 },
  mega: { mosi: 51, miso: 50, sck: 52 }, esp8266: { mosi: 13, miso: 12, sck: 14 },
  esp32: { mosi: 23, miso: 19, sck: 18 },
}
