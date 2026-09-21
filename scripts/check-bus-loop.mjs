import assert from 'node:assert/strict'
import { nextBusZ } from '../src/lib/scene-props.ts'

const lap = 35.2
assert.ok(Math.abs(nextBusZ(-14, 10, 11, 1, lap) + 12.8) < 1e-9)
assert.ok(Math.abs(nextBusZ(-14, 11, -24.2, 0, lap) - 11 - 10.2) < 1e-9)
assert.ok(nextBusZ(48.1, 11, 11, 0, lap) - 11 + 3.1 < -30)
