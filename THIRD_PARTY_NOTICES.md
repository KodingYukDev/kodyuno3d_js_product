# Third-party notices

## KodyUno element library (vendored)

The component artwork under `src/kodyuno/vendor/kody-elements/` is a vendored
fork of **Wokwi Elements**, redistributed under the MIT licence.

- Upstream project: Wokwi Elements — https://github.com/wokwi/wokwi-elements
- Copyright: Uri Shaked and contributors
- Licence: MIT — full text in
  `src/kodyuno/vendor/kody-elements/LICENSE.wokwi-elements.txt`

The source is committed to this repository rather than pulled from npm at build
time, so KodyUno keeps working regardless of what happens to the upstream
package. Custom element tags were renamed from the `wokwi-` prefix to `kody-`;
the drawings themselves are unmodified.

Board pin coordinates in `src/kodyuno/lib/boards/avr.ts` and the ESP32 DevKit V1
table in `src/kodyuno/lib/boards/esp32.ts` are read off that artwork, as are the
part terminal positions in `src/kodyuno/lib/elementParts.ts`.

## KodyUno original work

Everything else in KodyUno is written for this project and is not derived from
Wokwi, Tinkercad, or any other simulator:

- the C++ interpreter (`src/kodyuno/lib/cpp/`) — lexer, preprocessor, parser,
  runtime, Arduino core, and every library shim
- the circuit-net solver, breadboard model, and wiring interactions
- the generic devkit artwork (`src/kodyuno/components/Simulator/GenericBoard.tsx`)
  used for the ESP32-S3 / S2 / C3 / C6 and NodeMCU boards
- the board definitions, component catalogue, lesson content, and IDE
