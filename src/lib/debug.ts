type Listener = (debug: boolean) => void

let debug = false
const listeners = new Set<Listener>()

export const isDebug = () => debug

export function toggle() {
  debug = !debug
  for (const cb of listeners) cb(debug)
}

export function subscribe(cb: Listener): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
