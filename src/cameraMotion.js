// Pure camera follow and shot framing helpers for the previs editor.
const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

export const CAMERA_SHOT_PRESETS = Object.freeze({
  wide: { label: '远景', focalLength: 24, distance: 9, height: 4.2, lookHeight: 1.4 },
  medium: { label: '中景', focalLength: 50, distance: 5.2, height: 2.8, lookHeight: 1.25 },
  close: { label: '近景', focalLength: 85, distance: 3.2, height: 2.2, lookHeight: 1.35 },
})

const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback
const vector = (value, fallback) => Array.isArray(value) && value.length >= 3
  ? value.slice(0, 3).map((item, index) => finite(item, fallback[index]))
  : [...fallback]
const subjectHeight = actor => {
  const bodyHeight = { tall: 1.12, broad: 1.04, female: 0.98, male: 1.06 }[actor?.bodyType] || 1
  const scale = vector(actor?.scale, [1, 1, 1])
  return Math.max(0.25, bodyHeight * Math.abs(scale[1]))
}

export function frameScaleForActor(actor, referenceHeight = 1) {
  return subjectHeight(actor) / Math.max(0.25, finite(referenceHeight, 1))
}

export function rotationToward(position, target, roll = 0) {
  const eye = vector(position, [0, 2, 6])
  const point = vector(target, [0, 1, 0])
  let dx = point[0] - eye[0]
  let dy = point[1] - eye[1]
  let dz = point[2] - eye[2]
  const length = Math.hypot(dx, dy, dz)
  if (length < 1e-8) return [0, 0, roll]
  dx /= length; dy /= length; dz /= length
  return [Math.asin(Math.max(-1, Math.min(1, dy))), Math.atan2(-dx, -dz), roll]
}

export function shotPreset(kind = 'medium') {
  return CAMERA_SHOT_PRESETS[kind] || CAMERA_SHOT_PRESETS.medium
}

export function solveFollowCamera(actor, camera, follow = {}) {
  const actorPosition = vector(actor?.position, [0, 0, 0])
  const actorRotation = vector(actor?.rotation, [0, 0, 0])
  const preset = shotPreset(follow.shot)
  const subjectScale = frameScaleForActor(actor, follow.referenceHeight || 1)
  const distance = clamp(finite(follow.distance, preset.distance) * subjectScale, 1, 40)
  const height = clamp(finite(follow.height, preset.height) * subjectScale, 0.2, 20)
  const lookHeight = clamp(finite(follow.lookHeight, preset.lookHeight) * subjectScale, 0, 10)
  const orbit = finite(follow.orbitDegrees, 0) * Math.PI / 180
  const sideOffset = finite(follow.sideOffset, 0) * subjectScale
  const offset = [sideOffset, height, distance]
  const yaw = actorRotation[1] + orbit
  const cos = Math.cos(yaw)
  const sin = Math.sin(yaw)
  const position = [
    actorPosition[0] + offset[0] * cos + offset[2] * sin,
    actorPosition[1] + offset[1],
    actorPosition[2] - offset[0] * sin + offset[2] * cos,
  ]
  const target = [actorPosition[0], actorPosition[1] + lookHeight, actorPosition[2]]
  return {
    position,
    rotation: rotationToward(position, target),
    focalLength: clamp(finite(camera?.focalLength, finite(follow.focalLength, preset.focalLength)), 18, 120),
    aspectRatio: camera?.aspectRatio || '16:9',
  }
}
