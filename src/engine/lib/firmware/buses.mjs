// Byte-level master controller bridge. Device semantics belong to Hardware.
// `route` may claim an SPI byte for a register-level chip model (returns the
// MISO byte) before it falls through to the generic Hardware bridge.
export function attachUnoBuses(avr, uno, hardware, syncPins = () => {}, trace = () => {}, route = () => undefined) {
  const { cpu } = uno;
  const profile = uno.profile;
  const spi = new avr.AVRSPI(cpu, profile?.spiConfig ?? avr.spiConfig, uno.frequency);
  const twi = new avr.AVRTWI(cpu, profile?.twiConfig ?? avr.twiConfig, uno.frequency);
  const pinName = pin => (uno.pinId ? uno.pinId(pin) : pin);
  const spiPins = profile ? { mosi: pinName(profile.spi.mosi), miso: pinName(profile.spi.miso), sck: pinName(profile.spi.sck) } : { mosi: 11, miso: 12, sck: 13 };
  const sda = profile ? pinName(profile.twi.sda) : 'A4', scl = profile ? pinName(profile.twi.scl) : 'A5';
  function later(bus, operation, cycles, complete) {
    const start = cpu.cycles;
    cpu.addClockEvent(() => {
      complete();
      trace({ bus, operation, start, end: cpu.cycles, cycles });
    }, cycles);
  }
  spi.onByte = value => {
    syncPins(); // CS may change immediately before SPDR, inside a 256-cycle step.
    if (!spi.isMaster || spi.dataOrder !== 'msbFirst' || spi.spiMode !== 0) {
      throw new Error('AVR SPI bridge supports master MSB-first mode 0 only');
    }
    const routed = route(value);
    const response = routed === undefined ? hardware.spiTransfer(value, spiPins) : routed;
    later('spi', 'byte', spi.transferCycles, () => spi.completeTransfer(response));
  };
  let address = 0, bytes = [], writing = false;
  const flush = () => {
    if (writing && bytes.length) hardware.i2cWrite(address, bytes, sda, scl);
    bytes = []; writing = false;
  };
  const delay = (operation, bits, complete) => later('twi', operation, Math.ceil(uno.frequency / twi.sclFrequency * bits), complete);
  twi.eventHandler = {
    start(repeated) { flush(); delay(repeated ? 'restart' : 'start', 1, () => twi.completeStart()); },
    stop() { flush(); delay('stop', 1, () => twi.completeStop()); },
    connectToSlave(next, write) {
      syncPins(); address = next; writing = write; bytes = [];
      const ack = hardware.i2cWrite(address, [], sda, scl) === 0;
      delay(write ? 'address-write' : 'address-read', 9, () => twi.completeConnect(ack));
    },
    writeByte(value) {
      const ack = hardware.i2cWrite(address, [], sda, scl) === 0;
      if (ack) bytes.push(value);
      if (bytes.length > 256) throw new Error('AVR TWI transaction exceeds 256 bytes');
      delay('write', 9, () => twi.completeWrite(ack));
    },
    readByte(ack) {
      const value = hardware.i2cRead(address, 1, sda, scl)[0] ?? 0xff;
      delay(ack ? 'read-ack' : 'read-nack', 9, () => twi.completeRead(value));
    },
  };
  return { spi, twi };
}
