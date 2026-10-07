import { createElement, useMemo } from 'react'
import '@kodyuno/vendor/kody-elements'
import { useKodyUnoStore } from '@kodyuno/store/useKodyUnoStore'
import { BOARD_SCALE, BOARD_X, BOARD_Y, getBoard } from '@kodyuno/lib/boards'
import { GenericBoard } from './GenericBoard'
import { boardLedOn } from '@kodyuno/lib/boardLed'
import { LolinBoard } from './LolinBoard'

/**
 * The board currently on the canvas. Photo-real devkits (Uno, Nano, Mega,
 * ESP32 DevKit V1) come from the KodyUno element library; the rest are drawn
 * by GenericBoard from the same pin table the wire targets use.
 */
export function BoardGraphic() {
  const boardType = useKodyUnoStore((state) => state.boardType)
  const offset = useKodyUnoStore((state) => state.boardOffset)
  const pins = useKodyUnoStore((state) => state.pins)
  const runState = useKodyUnoStore((state) => state.runState)

  const board = useMemo(() => getBoard(boardType), [boardType])
  const running = runState === 'running'
  const ledOn = boardLedOn(board, pins, running || runState === 'paused')

  const { cssW, cssH } = board.artwork
  const width = cssW * BOARD_SCALE
  const height = cssH * BOARD_SCALE

  if (board.artwork.kind === 'generic') {
    return (
      <g transform={`translate(${BOARD_X + offset.x} ${BOARD_Y + offset.y}) scale(${BOARD_SCALE})`}>
        {board.id === 'esp8266'
          ? <LolinBoard board={board} ledOn={ledOn} />
          : <GenericBoard board={board} ledOn={ledOn} powerOn={running} />}
      </g>
    )
  }

  const ledProps =
    board.family === 'esp32'
      ? { led1: ledOn, ledPower: running }
      : { led13: ledOn, ledPower: running, ledTX: running, ledRX: false }

  return (
    <foreignObject x={BOARD_X + offset.x} y={BOARD_Y + offset.y} width={width} height={height} style={{ overflow: 'visible', pointerEvents: 'none' }}>
      <div style={{ width, height, overflow: 'hidden' }}>
        <div style={{ width: cssW, height: cssH, transform: `scale(${BOARD_SCALE})`, transformOrigin: '0 0' }}>
          {createElement(board.artwork.tag, {
            ...ledProps,
            ...board.artwork.props,
            style: { display: 'block' },
          })}
        </div>
      </div>
    </foreignObject>
  )
}

export function BoardView() {
  return (
    <svg viewBox="0 0 560 420" className="w-full h-full">
      <BoardGraphic />
    </svg>
  )
}
