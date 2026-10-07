import { useKodyUnoStore } from '@kodyuno/store/useKodyUnoStore'

/**
 * Makes wired buzzers audible. The engine only records the buzzer's state
 * (active / frequency from tone()); this turns it into a WebAudio square
 * wave, one voice per buzzer, muted while the sketch is stopped.
 */
export function startBuzzerAudio(isMuted: () => boolean): () => void {
  let context: AudioContext | null = null
  const voices = new Map<string, { osc: OscillatorNode; gain: GainNode }>()

  const ensure = () => {
    if (!context) context = new AudioContext()
    if (context.state === 'suspended') void context.resume()
    return context
  }

  const stopVoice = (id: string) => {
    const voice = voices.get(id)
    if (!voice) return
    voice.gain.gain.setTargetAtTime(0, voice.osc.context.currentTime, 0.01)
    voice.osc.stop(voice.osc.context.currentTime + 0.05)
    voices.delete(id)
  }

  const sync = () => {
    const state = useKodyUnoStore.getState()
    const running = state.runState === 'running'
    const wanted = new Map<string, number>()
    if (running && !isMuted()) {
      for (const comp of state.components) {
        if (comp.type !== 'buzzer') continue
        const frequency = typeof comp.state.frequency === 'number' ? comp.state.frequency : 0
        if (frequency > 0) wanted.set(comp.id, frequency)
        // An active buzzer driven HIGH without tone() beeps at its own pitch.
        else if (comp.state.active === true) wanted.set(comp.id, 2300)
      }
    }
    for (const id of [...voices.keys()]) if (!wanted.has(id)) stopVoice(id)
    if (wanted.size === 0) return
    const ctx = ensure()
    for (const [id, frequency] of wanted) {
      let voice = voices.get(id)
      if (!voice) {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = 'square'
        gain.gain.value = 0
        osc.connect(gain).connect(ctx.destination)
        osc.start()
        gain.gain.setTargetAtTime(0.05, ctx.currentTime, 0.005)
        voice = { osc, gain }
        voices.set(id, voice)
      }
      voice.osc.frequency.setTargetAtTime(Math.min(20000, Math.max(20, frequency)), ctx.currentTime, 0.002)
    }
  }

  const unsubscribe = useKodyUnoStore.subscribe((state, previous) => {
    if (state.components !== previous.components || state.runState !== previous.runState) sync()
  })
  return () => {
    unsubscribe()
    for (const id of [...voices.keys()]) stopVoice(id)
    void context?.close()
  }
}
