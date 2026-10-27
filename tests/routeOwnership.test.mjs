import test from 'node:test'
import assert from 'node:assert/strict'
import { removeRouteOwnedKeyframes, routeOwnedKeyframe } from '../src/routeOwnership.js'

test('route-owned keys are recognized by explicit source and recorded frame', () => {
  const route = { id: 'actor-a', keyframes: [0, 12], keyframesOwned: true }
  assert.equal(routeOwnedKeyframe({ frame: 0, source: 'route', routeId: 'actor-a' }, route), true)
  assert.equal(routeOwnedKeyframe({ frame: 12 }, route), true)
  assert.equal(routeOwnedKeyframe({ frame: 12, source: 'manual' }, route), false)
  assert.equal(routeOwnedKeyframe({ frame: 13, source: 'manual' }, route), false)
})

test('clearing a route preserves manual keys in and outside route range', () => {
  const route = { id: 'actor-a', keyframes: [0, 12, 24], keyframesOwned: true }
  const keys = [
    { frame: 0, source: 'route', routeId: 'actor-a' },
    { frame: 12, source: 'route', routeId: 'actor-a' },
    { frame: 24, source: 'route', routeId: 'actor-a' },
    { frame: 12, source: 'manual' },
    { frame: 30, source: 'manual' },
  ]
  assert.deepEqual(removeRouteOwnedKeyframes(keys, route), [
    { frame: 12, source: 'manual' },
    { frame: 30, source: 'manual' },
  ])
})
