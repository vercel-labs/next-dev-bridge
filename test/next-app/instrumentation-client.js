import { observeNextDev } from '../../src/client'

const events = []

globalThis.__NEXT_DEV_BRIDGE_TEST_EVENTS__ = events
globalThis.__NEXT_DEV_BRIDGE_TEST_OBSERVER__ = observeNextDev(
  (event, state) => {
    events.push({ event, state })
  }
)
