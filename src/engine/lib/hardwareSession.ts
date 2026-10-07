import { nullHardware, type Hardware } from './cpp/hardware'

/** One bridge per run: bus state is fresh and retained callbacks become inert. */
export function createHardwareSession(create: () => Hardware) {
  const bridge = create()
  const inactive = nullHardware(bridge.board)
  let active = true
  const hardware = new Proxy(bridge, {
    get(target, key: keyof Hardware) {
      const value = target[key]
      if (typeof value !== 'function') return value
      // Check at invocation, not lookup: shims may retain method references.
      return (...args: unknown[]) => {
        const receiver = active ? target : inactive
        return Reflect.apply(receiver[key] as (...args: unknown[]) => unknown, receiver, args)
      }
    },
  })
  return { hardware, revoke: () => { if (active) bridge.dispose?.(); active = false } }
}
