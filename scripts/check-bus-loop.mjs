import assert from 'node:assert/strict'
import { busCycleAt } from '../src/lib/scene-props.ts'

const waiting = busCycleAt(10)
const crossing = busCycleAt(16)
const stopped = busCycleAt(18.5)
const dwelling = busCycleAt(20.5)
const leaving = busCycleAt(22)

assert.equal(waiting.x, 20)
assert.ok(waiting.x > crossing.x && crossing.x > stopped.x)
assert.equal(stopped.x, -5.5)
assert.equal(dwelling.x, stopped.x)
assert.ok(leaving.x < stopped.x)
assert.equal(busCycleAt(13.9).red, false)
assert.equal(crossing.red, true)
assert.equal(dwelling.red, true)
assert.equal(leaving.red, false)
