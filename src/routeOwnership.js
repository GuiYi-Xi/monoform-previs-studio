// Ownership helpers keep route-baked keys separate from hand-authored keys.
export function routeOwnedKeyframe(key, route = {}) {
  if (key?.source === 'manual') return false
  const markedRouteKey = key?.source === 'route' && (!key.routeId || key.routeId === route.id)
  if (markedRouteKey) return true
  if (!route.keyframesOwned || key?.source === 'manual') return false
  const frame = Number(key?.frame)
  const recordedFrames = Array.isArray(route.keyframes)
    ? route.keyframes.some(value => Number(value) === frame)
    : false
  return recordedFrames
}

export function removeRouteOwnedKeyframes(keys, route = {}) {
  return (Array.isArray(keys) ? keys : []).filter(key => !routeOwnedKeyframe(key, route))
}

export function mergeRouteKeyframes(existingKeys, routeKeys, route = {}) {
  const existing = Array.isArray(existingKeys) ? existingKeys : []
  const manualFrames = new Set(existing.filter(key => !routeOwnedKeyframe(key, route)).map(key => Number(key?.frame)))
  const preserved = removeRouteOwnedKeyframes(existing, route)
  const generated = (Array.isArray(routeKeys) ? routeKeys : []).filter(key => !manualFrames.has(Number(key?.frame)))
  return [...preserved, ...generated]
}
