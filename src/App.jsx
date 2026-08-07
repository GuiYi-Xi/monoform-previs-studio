import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Box, BoxSelect, Camera, ChevronDown, ChevronUp, CircleDot, Copy, Download,
  FileImage, FileVideo2, Focus, FolderOpen, Grid3X3, Import, Link2, Lock, MousePointer2, Move3D, Pause, Play, Plus,
  Redo2, RotateCw, Save, Settings2, SkipBack, SkipForward, Sparkles,
  ScanLine, Trash2, Undo2, Unlink2, UserRound, Video, ZoomIn,
  Unlock,
} from 'lucide-react'
import { MainViewport, CameraPreview } from './Viewport.jsx'
import { ShotsPanel } from './ShotsPanel.jsx'
import { JOINT_DEFINITIONS, JOINT_GROUPS, RIG_PRESET_GROUPS, RIG_PRESET_OPTIONS, cloneJointPose, interpolateJointPose, normalizePoseId, poseCanLoop, poseForObject, presetJoints, presetPhase, presetRoot } from './rig.js'

const CAMERA_ID = '__shot_camera__'
const PROJECT_STORAGE_KEY = 'monoform-project'
const LEGACY_PROJECT_STORAGE_KEY = 'stageframe-project'
const CUSTOM_POSE_STORAGE_KEY = 'monoform-custom-poses'
const PROJECT_VERSION = 14
const DEFAULT_PROJECT_SETTINGS = {
  name: '未命名场景',
  fps: 24,
  durationSeconds: 5,
  loopPlayback: false,
}
const FPS_OPTIONS = [24, 25, 30]
const FOCAL_LENGTH_PRESETS = [18, 24, 35, 50, 85, 120]
const BRAND_MARK_URL = `${import.meta.env.BASE_URL}branding/monoform-mark.png`
const ASPECT_RATIOS = [
  { value: '16:9', label: '16 : 9 · 横屏视频', ratio: 16 / 9 },
  { value: '9:16', label: '9 : 16 · 竖屏短视频', ratio: 9 / 16 },
  { value: '4:3', label: '4 : 3 · 经典画幅', ratio: 4 / 3 },
  { value: '3:2', label: '3 : 2 · 摄影画幅', ratio: 3 / 2 },
  { value: '1:1', label: '1 : 1 · 方形画幅', ratio: 1 },
  { value: '1.85:1', label: '1.85 : 1 · 影院宽屏', ratio: 1.85 },
  { value: '2.39:1', label: '2.39 : 1 · 电影宽银幕', ratio: 2.39 },
]
const aspectValue = value => ASPECT_RATIOS.find(option => option.value === value)?.ratio || 16 / 9
const nextPaint = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))

function exportDimensionsForAspect(aspectRatio) {
  const ratio = aspectValue(aspectRatio)
  const even = value => Math.max(2, Math.round(value / 2) * 2)
  return ratio >= 1
    ? { width: 1280, height: even(1280 / ratio) }
    : { width: even(1280 * ratio), height: 1280 }
}

const initialObjects = [
  {
    id: 'actor-lead', name: '人物 · 主角', type: 'person', bodyType: 'standard', pose: 'walk',
    poseTime: presetPhase('walk'), continuousMotion: false, position: [-1.25, 0, 0.3], rotation: [0, 0.25, 0], scale: [1, 1, 1], color: '#e8e3d8', joints: presetJoints(),
  },
  {
    id: 'block-stage', name: '平台', type: 'box',
    position: [1.4, 0.45, -0.8], rotation: [0, -0.18, 0], scale: [2.8, 0.9, 2.1], color: '#9a968c',
  },
  {
    id: 'block-step', name: '台阶', type: 'box',
    position: [2.9, 0.18, 0.55], rotation: [0, -0.18, 0], scale: [1.7, 0.36, 1.1], color: '#77746d',
  },
]

const DEFAULT_CAMERA_POSITION = [7.4, 4.6, 8.2]
const LEGACY_DEFAULT_CAMERA_TARGET = [0.2, 1.2, 0]
const initialCamera = {
  position: [...DEFAULT_CAMERA_POSITION],
  rotation: cameraRotationToward(DEFAULT_CAMERA_POSITION, LEGACY_DEFAULT_CAMERA_TARGET),
  focalLength: 42,
  aspectRatio: '16:9',
}
const DEFAULT_REFERENCE = {
  image: '',
  name: '',
  opacity: 0.45,
  scale: 1,
  x: 0,
  y: 0,
  visible: true,
  includeInExport: false,
}

const initialKeyframes = []
const initialCharacterKeyframes = {}

const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
const radToDeg = value => Math.round((value * 180 / Math.PI) * 10) / 10
const degToRad = value => Number(value || 0) * Math.PI / 180
const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
const lerp = (a, b, t) => a + (b - a) * t
const lerpAngle = (a, b, t) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t
const ease = t => t * t * (3 - 2 * t)
const normalizeInterpolation = value => ['smooth', 'linear', 'hold'].includes(value) ? value : 'smooth'
const segmentAmount = (key, amount) => key?.interpolation === 'hold' ? 0 : key?.interpolation === 'linear' ? amount : ease(amount)
const POSE_LABELS = Object.fromEntries(RIG_PRESET_OPTIONS)
const poseLabel = pose => POSE_LABELS[normalizePoseId(pose)] || '自定义动作'

function finiteVector3(value, fallback) {
  return Array.isArray(value) && value.length >= 3
    ? value.slice(0, 3).map((item, index) => Number.isFinite(Number(item)) ? Number(item) : fallback[index])
    : [...fallback]
}

function cameraRotationToward(position, target) {
  const eye = finiteVector3(position, DEFAULT_CAMERA_POSITION)
  const point = finiteVector3(target, LEGACY_DEFAULT_CAMERA_TARGET)
  let dx = point[0] - eye[0]
  let dy = point[1] - eye[1]
  let dz = point[2] - eye[2]
  const length = Math.hypot(dx, dy, dz)
  if (length < 1e-8) return [0, 0, 0]
  dx /= length; dy /= length; dz /= length
  return [Math.asin(Math.min(1, Math.max(-1, dy))), Math.atan2(-dx, -dz), 0]
}

function normalizeCamera(camera = {}) {
  const position = finiteVector3(camera.position, initialCamera.position)
  const rotation = Array.isArray(camera.rotation)
    ? finiteVector3(camera.rotation, initialCamera.rotation)
    : cameraRotationToward(position, camera.target || LEGACY_DEFAULT_CAMERA_TARGET)
  return {
    position,
    rotation,
    focalLength: clamp(Number(camera.focalLength) || initialCamera.focalLength, 18, 120),
    aspectRatio: ASPECT_RATIOS.some(option => option.value === camera.aspectRatio) ? camera.aspectRatio : initialCamera.aspectRatio,
  }
}

function normalizeCameraKeyframes(keys = [], fallbackCamera = initialCamera) {
  return (keys || []).map(key => {
    const position = finiteVector3(key.position, fallbackCamera.position)
    return {
      frame: Math.max(0, Math.round(Number(key.frame) || 0)),
      interpolation: normalizeInterpolation(key.interpolation),
      position,
      rotation: Array.isArray(key.rotation)
        ? finiteVector3(key.rotation, fallbackCamera.rotation)
        : cameraRotationToward(position, key.target || LEGACY_DEFAULT_CAMERA_TARGET),
      focalLength: clamp(Number(key.focalLength) || fallbackCamera.focalLength, 18, 120),
    }
  })
}

function normalizeReference(reference = {}) {
  const image = typeof reference.image === 'string' && /^data:image\/(?:png|jpe?g|webp);base64,/i.test(reference.image)
    ? reference.image
    : ''
  return {
    image,
    name: image ? String(reference.name || '参考图').slice(0, 80) : '',
    opacity: clamp(Number(reference.opacity) || DEFAULT_REFERENCE.opacity, 0.1, 1),
    scale: clamp(Number(reference.scale) || DEFAULT_REFERENCE.scale, 0.25, 2),
    x: clamp(Number(reference.x) || 0, -75, 75),
    y: clamp(Number(reference.y) || 0, -75, 75),
    visible: reference.visible !== false,
    includeInExport: reference.includeInExport === true,
  }
}

function normalizeProjectSettings(settings = {}) {
  const fps = FPS_OPTIONS.includes(Number(settings.fps)) ? Number(settings.fps) : DEFAULT_PROJECT_SETTINGS.fps
  const durationSeconds = clamp(Math.round(Number(settings.durationSeconds) || DEFAULT_PROJECT_SETTINGS.durationSeconds), 1, 60)
  return {
    name: String(settings.name || DEFAULT_PROJECT_SETTINGS.name).trim().slice(0, 40) || DEFAULT_PROJECT_SETTINGS.name,
    fps,
    durationSeconds,
    loopPlayback: Boolean(settings.loopPlayback),
  }
}

function timecodeAtFrame(frame, fps) {
  const safeFrame = Math.max(0, Math.round(frame))
  const frames = safeFrame % fps
  const totalSeconds = Math.floor(safeFrame / fps)
  const seconds = totalSeconds % 60
  const minutes = Math.floor(totalSeconds / 60) % 60
  const hours = Math.floor(totalSeconds / 3600)
  return [hours, minutes, seconds, frames].map(value => String(value).padStart(2, '0')).join(':')
}

function normalizePerson(object) {
  if (object?.type !== 'person') return object
  const pose = normalizePoseId(object.pose)
  return {
    ...object,
    pose,
    poseTime: Number.isFinite(object.poseTime) ? object.poseTime : presetPhase(pose),
    rigRoot: Array.isArray(object.rigRoot) ? object.rigRoot.slice(0, 3).map(value => Number(value) || 0) : [0, 0, 0],
    joints: cloneJointPose(object.joints),
    footLock: Boolean(object.footLock),
    continuousMotion: poseCanLoop(pose) && Boolean(object.continuousMotion),
  }
}

function readCustomPoses() {
  try {
    const poses = JSON.parse(localStorage.getItem(CUSTOM_POSE_STORAGE_KEY) || '[]')
    if (!Array.isArray(poses)) return []
    return poses.filter(pose => pose?.id && pose?.name).map(pose => ({
      ...pose,
      pose: normalizePoseId(pose.pose),
      poseTime: Number.isFinite(pose.poseTime) ? pose.poseTime : presetPhase(pose.pose),
      rigRoot: Array.isArray(pose.rigRoot) ? pose.rigRoot.slice(0, 3) : presetRoot(),
      joints: cloneJointPose(pose.joints),
    }))
  } catch {
    return []
  }
}

function normalizeObjectTracks(tracks = {}) {
  return Object.fromEntries(Object.entries(tracks).map(([id, keys]) => [id, (keys || []).map(key => {
    const pose = normalizePoseId(key.pose)
    return {
      ...key,
      interpolation: normalizeInterpolation(key.interpolation),
      pose,
      poseTime: Number.isFinite(key.poseTime) ? key.poseTime : presetPhase(pose),
      continuousMotion: poseCanLoop(pose) ? (key.continuousMotion === undefined ? undefined : Boolean(key.continuousMotion)) : false,
      rigRoot: Array.isArray(key.rigRoot) ? key.rigRoot.slice(0, 3).map(value => Number(value) || 0) : [0, 0, 0],
      joints: cloneJointPose(key.joints),
    }
  })]))
}

const cloneProjectValue = value => JSON.parse(JSON.stringify(value))
const defaultShotName = index => `镜头 ${String(index + 1).padStart(2, '0')}`

function uniqueShotName(shots, preferred) {
  const used = new Set(shots.map(shot => String(shot.name || '').trim().toLocaleLowerCase()))
  const base = String(preferred || '镜头').trim().slice(0, 30) || '镜头'
  if (!used.has(base.toLocaleLowerCase())) return base
  for (let copy = 2; copy <= 99; copy += 1) {
    const suffix = ` ${copy}`
    const candidate = `${base.slice(0, 30 - suffix.length)}${suffix}`
    if (!used.has(candidate.toLocaleLowerCase())) return candidate
  }
  return `${base.slice(0, 23)} ${uid().slice(-6)}`
}

function normalizeShot(shot, index, fallback) {
  const objects = (Array.isArray(shot?.objects) ? shot.objects : fallback.objects).map(normalizePerson)
  const camera = normalizeCamera(shot?.camera || fallback.camera)
  const keyframes = normalizeCameraKeyframes(shot?.keyframes ?? fallback.keyframes ?? [], camera)
  const objectKeyframes = normalizeObjectTracks(shot?.objectKeyframes || shot?.characterKeyframes || fallback.objectKeyframes || {})
  const timing = normalizeProjectSettings({
    fps: shot?.fps ?? shot?.settings?.fps ?? fallback.settings.fps,
    durationSeconds: shot?.durationSeconds ?? shot?.settings?.durationSeconds ?? fallback.settings.durationSeconds,
    loopPlayback: shot?.loopPlayback ?? shot?.settings?.loopPlayback ?? fallback.settings.loopPlayback,
  })
  const maxFrame = Math.max(0, ...keyframes.map(key => key.frame), ...Object.values(objectKeyframes).flatMap(track => (track || []).map(key => key.frame)))
  if (maxFrame > timing.fps * timing.durationSeconds) timing.durationSeconds = clamp(Math.ceil(maxFrame / timing.fps), 1, 60)
  return {
    id: String(shot?.id || `shot-${uid()}`),
    name: String(shot?.name || defaultShotName(index)).trim().slice(0, 30) || defaultShotName(index),
    thumbnail: typeof shot?.thumbnail === 'string' && shot.thumbnail.startsWith('data:image/') ? shot.thumbnail : '',
    fps: timing.fps,
    durationSeconds: timing.durationSeconds,
    loopPlayback: timing.loopPlayback,
    objects,
    camera,
    reference: normalizeReference(shot?.reference || fallback.reference),
    keyframes,
    objectKeyframes,
  }
}

function normalizeProjectData(data) {
  if (!data) return null
  const firstShot = Array.isArray(data.shots) ? data.shots[0] : null
  const sourceObjects = Array.isArray(data.objects) ? data.objects : firstShot?.objects
  if (!Array.isArray(sourceObjects)) return null
  const settings = normalizeProjectSettings(data.settings)
  const fallback = {
    settings,
    objects: sourceObjects,
    camera: data.camera || firstShot?.camera || initialCamera,
    reference: data.reference || firstShot?.reference || DEFAULT_REFERENCE,
    keyframes: data.keyframes || [],
    objectKeyframes: data.objectKeyframes || data.characterKeyframes || {},
  }
  const rawShots = Array.isArray(data.shots) && data.shots.length ? data.shots : [{
    id: 'shot-01',
    name: '镜头 01',
    fps: settings.fps,
    durationSeconds: settings.durationSeconds,
    loopPlayback: settings.loopPlayback,
    objects: fallback.objects,
    camera: fallback.camera,
    keyframes: fallback.keyframes,
    objectKeyframes: fallback.objectKeyframes,
  }]
  const shots = rawShots.slice(0, 30).map((shot, index) => normalizeShot(shot, index, fallback))
  const activeShotId = shots.some(shot => shot.id === data.activeShotId) ? data.activeShotId : shots[0].id
  const activeShot = shots.find(shot => shot.id === activeShotId) || shots[0]
  return {
    ...data,
    version: PROJECT_VERSION,
    settings: { ...settings, fps: activeShot.fps, durationSeconds: activeShot.durationSeconds, loopPlayback: activeShot.loopPlayback },
    activeShotId,
    shots,
    objects: activeShot.objects,
    camera: activeShot.camera,
    reference: activeShot.reference,
    keyframes: activeShot.keyframes,
    objectKeyframes: activeShot.objectKeyframes,
  }
}

function readCachedProject() {
  try {
    const current = localStorage.getItem(PROJECT_STORAGE_KEY)
    const legacy = current ? null : localStorage.getItem(LEGACY_PROJECT_STORAGE_KEY)
    const serialized = current || legacy
    const data = JSON.parse(serialized || 'null')
    const normalized = normalizeProjectData(data)
    if (!normalized) return null
    if (!current && legacy) localStorage.setItem(PROJECT_STORAGE_KEY, legacy)
    return normalized
  } catch {
    return null
  }
}

function projectData({ settings, objects, camera, reference, keyframes, objectKeyframes, shots, activeShotId }) {
  const normalizedSettings = normalizeProjectSettings(settings)
  const sourceShots = shots?.length ? shots : [{ id: 'shot-01', name: '镜头 01' }]
  const resolvedActiveShotId = sourceShots.some(shot => shot.id === activeShotId) ? activeShotId : sourceShots[0].id
  const liveShot = {
    ...(sourceShots.find(shot => shot.id === resolvedActiveShotId) || sourceShots[0]),
    id: resolvedActiveShotId,
    fps: normalizedSettings.fps,
    durationSeconds: normalizedSettings.durationSeconds,
    loopPlayback: normalizedSettings.loopPlayback,
    objects,
    camera,
    reference,
    keyframes,
    objectKeyframes,
  }
  const serializedShots = sourceShots.map(shot => shot.id === resolvedActiveShotId ? liveShot : shot)
  return {
    version: PROJECT_VERSION,
    settings: normalizedSettings,
    activeShotId: resolvedActiveShotId,
    shots: serializedShots,
    objects,
    camera,
    reference,
    keyframes,
    objectKeyframes,
  }
}

function cameraAtFrame(keyframes, frame, aspectRatio = '16:9') {
  const sorted = [...keyframes].sort((a, b) => a.frame - b.frame)
  if (!sorted.length) return { ...initialCamera, aspectRatio }
  const exact = sorted.find(key => key.frame === frame)
  if (exact) return { ...exact, aspectRatio }
  if (frame <= sorted[0].frame) return { ...sorted[0], aspectRatio }
  if (frame >= sorted.at(-1).frame) return { ...sorted.at(-1), aspectRatio }
  const rightIndex = sorted.findIndex(key => key.frame >= frame)
  const left = sorted[rightIndex - 1]
  const right = sorted[rightIndex]
  const t = segmentAmount(left, (frame - left.frame) / Math.max(1, right.frame - left.frame))
  return {
    position: left.position.map((value, index) => lerp(value, right.position[index], t)),
    rotation: left.rotation.map((value, index) => lerpAngle(value, right.rotation[index], t)),
    focalLength: lerp(left.focalLength, right.focalLength, t),
    aspectRatio,
  }
}

function objectKeyframeFromObject(object, frame) {
  const rig = poseForObject(object)
  return {
    frame,
    interpolation: 'smooth',
    position: [...object.position],
    rotation: [...object.rotation],
    scale: [...object.scale],
    pose: normalizePoseId(object.pose),
    poseTime: Number.isFinite(object.poseTime) ? object.poseTime : presetPhase(object.pose),
    continuousMotion: poseCanLoop(object.pose) && Boolean(object.continuousMotion),
    rigRoot: [...rig.root],
    joints: cloneJointPose(rig.joints),
  }
}

function objectAtFrame(object, keyframes = [], frame, fps = DEFAULT_PROJECT_SETTINGS.fps) {
  if (!object) return object
  const sorted = [...keyframes].sort((a, b) => a.frame - b.frame)
  if (!sorted.length) return object
  const motionEnabled = key => poseCanLoop(key.pose || object.pose) && (key.continuousMotion === undefined ? Boolean(object.continuousMotion) : Boolean(key.continuousMotion))
  const sameState = (leftKey, rightKey) => normalizePoseId(leftKey.pose || object.pose) === normalizePoseId(rightKey.pose || object.pose) && motionEnabled(leftKey) === motionEnabled(rightKey)
  const stateStartFrame = key => {
    let index = sorted.indexOf(key)
    while (index > 0 && sameState(sorted[index - 1], sorted[index])) index -= 1
    return sorted[index]?.frame ?? key.frame
  }
  const applyKey = key => ({
    ...object,
    position: [...key.position],
    rotation: [...key.rotation],
    scale: [...key.scale],
    pose: normalizePoseId(key.pose || object.pose),
    poseTime: Number.isFinite(key.poseTime) ? key.poseTime : presetPhase(key.pose || object.pose),
    continuousMotion: motionEnabled(key),
    motionStartTime: stateStartFrame(key) / fps,
    rigRoot: [...(key.rigRoot || poseForObject({ ...object, pose: key.pose || object.pose }).root)],
    joints: cloneJointPose(key.joints || poseForObject({ ...object, pose: key.pose || object.pose }).joints),
  })
  const exact = sorted.find(key => key.frame === frame)
  if (exact) return applyKey(exact)
  if (frame <= sorted[0].frame) return applyKey(sorted[0])
  if (frame >= sorted.at(-1).frame) return applyKey(sorted.at(-1))
  const rightIndex = sorted.findIndex(key => key.frame >= frame)
  const left = sorted[rightIndex - 1]
  const right = sorted[rightIndex]
  const t = segmentAmount(left, (frame - left.frame) / Math.max(1, right.frame - left.frame))
  const leftRoot = left.rigRoot || poseForObject({ ...object, pose: left.pose || object.pose }).root
  const rightRoot = right.rigRoot || poseForObject({ ...object, pose: right.pose || object.pose }).root
  const leftPoseTime = Number.isFinite(left.poseTime) ? left.poseTime : presetPhase(left.pose || object.pose)
  const rightPoseTime = Number.isFinite(right.poseTime) ? right.poseTime : presetPhase(right.pose || object.pose)
  const interpolateState = sameState(left, right)
  return {
    ...object,
    position: left.position.map((value, index) => lerp(value, right.position[index], t)),
    rotation: left.rotation.map((value, index) => lerp(value, right.rotation[index], t)),
    scale: left.scale.map((value, index) => lerp(value, right.scale[index], t)),
    pose: normalizePoseId(left.pose || object.pose),
    poseTime: interpolateState ? lerp(leftPoseTime, rightPoseTime, t) : leftPoseTime,
    continuousMotion: motionEnabled(left),
    motionStartTime: stateStartFrame(left) / fps,
    rigRoot: interpolateState ? leftRoot.map((value, index) => lerp(value, rightRoot[index], t)) : [...leftRoot],
    joints: interpolateState ? interpolateJointPose(
      left.joints || poseForObject({ ...object, pose: left.pose || object.pose }).joints,
      right.joints || poseForObject({ ...object, pose: right.pose || object.pose }).joints,
      t,
    ) : cloneJointPose(left.joints || poseForObject({ ...object, pose: left.pose || object.pose }).joints),
  }
}

function objectsAtFrame(objects, objectKeyframes, frame, fps) {
  return objects.map(object => objectAtFrame(object, objectKeyframes[object.id], frame, fps))
}

function rotateVectorXYZ(vector, rotation = [0, 0, 0]) {
  let [x, y, z] = vector
  const [rx, ry, rz] = rotation
  const cosX = Math.cos(rx); const sinX = Math.sin(rx)
  const cosY = Math.cos(ry); const sinY = Math.sin(ry)
  const cosZ = Math.cos(rz); const sinZ = Math.sin(rz)
  ;[y, z] = [y * cosX - z * sinX, y * sinX + z * cosX]
  ;[x, z] = [x * cosY + z * sinY, -x * sinY + z * cosY]
  ;[x, y] = [x * cosZ - y * sinZ, x * sinZ + y * cosZ]
  return [x, y, z]
}

function visualCenterForObject(object) {
  if (!object) return [0, 0, 0]
  const position = object.position || [0, 0, 0]
  if (object.type !== 'person') return [...position]
  const bodyHeight = { tall: 1.12, broad: 1.04, female: 0.98, male: 1.06 }[object.bodyType] || 1
  const root = object.rigRoot || [0, 0, 0]
  const scale = object.scale || [1, 1, 1]
  const localCenter = [root[0] * scale[0], (root[1] + bodyHeight) * scale[1], root[2] * scale[2]]
  const offset = rotateVectorXYZ(localCenter, object.rotation)
  return position.map((value, index) => value + offset[index])
}

function fallbackCharacterKeyframes() {
  return {}
}

function ToolButton({ icon: Icon, active, label, onClick, disabled = false, shortcut }) {
  return (
    <button className={`icon-button ${active ? 'is-active' : ''}`} onClick={onClick} disabled={disabled} title={`${label}${shortcut ? ` (${shortcut})` : ''}`} aria-label={label}>
      <Icon size={15} strokeWidth={1.8} />
    </button>
  )
}

function AxisSlider({ label, title, value, onChange, accent, min, max, step, unit = '', disabled = false, locked = false, onToggleLock }) {
  const numericValue = Number.isFinite(Number(value)) ? Number(value) : 0
  const safeMin = Math.min(min, Math.floor(numericValue / step) * step)
  const safeMax = Math.max(max, Math.ceil(numericValue / step) * step)
  const digits = step < 0.1 ? 2 : step < 1 ? 1 : 0
  return (
    <div className={`axis-slider ${onToggleLock ? 'has-axis-lock' : ''} ${locked ? 'is-axis-locked' : ''}`} style={{ '--axis-color': accent }}>
      <span>{label}</span>
      <input aria-label={`${title} ${label}`} type="range" min={safeMin} max={safeMax} step={step} value={numericValue} onChange={event => onChange(Number(event.target.value))} disabled={disabled || locked} />
      <output>{numericValue.toFixed(digits)}{unit}</output>
      {onToggleLock && <button type="button" className="axis-lock-button" aria-label={`${locked ? '解除' : '锁定'}缩放 ${label} 轴`} aria-pressed={locked} title={`${locked ? '解除' : '锁定'} ${label} 轴缩放`} onClick={onToggleLock}>{locked ? <Lock size={10} /> : <Unlock size={10} />}</button>}
    </div>
  )
}

function VectorFields({ title, value, onChange, degrees = false, kind = 'position', disabled = false, proportionalScale = false, scaleAxisLocks = [false, false, false], onToggleProportionalScale, onToggleScaleAxis }) {
  const display = degrees ? value.map(radToDeg) : value
  const settings = degrees
    ? { min: -180, max: 180, step: 1, unit: '°' }
    : kind === 'scale'
      ? { min: 0.1, max: 5, step: 0.05, unit: '' }
      : { min: -30, max: 30, step: 0.05, unit: '' }
  const update = (index, next) => {
    if (kind === 'scale' && scaleAxisLocks[index]) return
    const copy = [...display]
    if (kind === 'scale' && proportionalScale) {
      const baseline = Math.max(0.0001, Math.abs(display[index]))
      const ratio = next / baseline
      display.forEach((current, axis) => { copy[axis] = scaleAxisLocks[axis] ? current : Math.max(0.05, current * ratio) })
    } else copy[index] = next
    onChange(degrees ? copy.map(degToRad) : copy)
  }
  return (
    <div className="property-group">
      <div className="property-label-row">
        <div className="property-label">{title}</div>
        {kind === 'scale' && <button type="button" className={`proportional-lock ${proportionalScale ? 'is-active' : ''}`} aria-pressed={proportionalScale} onClick={onToggleProportionalScale} disabled={disabled} title="开启后拖动任意未锁定轴，其他未锁定轴按原比例同步缩放">{proportionalScale ? <Link2 size={11} /> : <Unlink2 size={11} />} 等比</button>}
      </div>
      <div className="axis-sliders">
        <AxisSlider label="X" title={title} value={display[0]} onChange={value => update(0, value)} accent="#d7675b" disabled={disabled} locked={kind === 'scale' && Boolean(scaleAxisLocks[0])} onToggleLock={kind === 'scale' ? () => onToggleScaleAxis?.(0) : null} {...settings} />
        <AxisSlider label="Y" title={title} value={display[1]} onChange={value => update(1, value)} accent="#76a96c" disabled={disabled} locked={kind === 'scale' && Boolean(scaleAxisLocks[1])} onToggleLock={kind === 'scale' ? () => onToggleScaleAxis?.(1) : null} {...settings} />
        <AxisSlider label="Z" title={title} value={display[2]} onChange={value => update(2, value)} accent="#5d87c7" disabled={disabled} locked={kind === 'scale' && Boolean(scaleAxisLocks[2])} onToggleLock={kind === 'scale' ? () => onToggleScaleAxis?.(2) : null} {...settings} />
      </div>
    </div>
  )
}

function AssetCard({ icon: Icon, title, subtitle, onClick, previewClass = '' }) {
  return (
    <button className="asset-card" onClick={onClick}>
      <span className={`asset-preview ${previewClass}`}><Icon size={28} strokeWidth={1.2} /></span>
      <span className="asset-copy"><strong>{title}</strong><small>{subtitle}</small></span>
      <Plus className="asset-add" size={14} />
    </button>
  )
}

function SceneList({ objects, selectedId, onSelect, onToggleVisible, onToggleLock }) {
  return (
    <div className="scene-list">
      <div className={`scene-row ${selectedId === CAMERA_ID ? 'is-selected' : ''}`} onClick={() => onSelect(CAMERA_ID)}>
        <Camera size={14} /><span>主摄像机</span><i className="status-dot live" />
      </div>
      {objects.map(object => (
        <div key={object.id} className={`scene-row ${selectedId === object.id ? 'is-selected' : ''}`} onClick={() => onSelect(object.id)}>
          {object.type === 'person' ? <UserRound size={14} /> : object.type === 'model' ? <Sparkles size={14} /> : object.type === 'depthMesh' ? <ScanLine size={14} /> : <Box size={14} />}
          <span>{object.name}</span>
          <button className="scene-row-action" title={object.locked ? '解除锁定' : '锁定物体'} onClick={event => { event.stopPropagation(); onToggleLock(object.id) }}>{object.locked ? <Lock size={11} /> : <Unlock size={11} />}</button>
          <button className="scene-row-action visibility-action" title={object.visible === false ? '显示物体' : '隐藏物体'} onClick={event => { event.stopPropagation(); onToggleVisible(object.id) }}><i className={`status-dot ${object.visible === false ? '' : 'on'}`} /></button>
        </div>
      ))}
    </div>
  )
}

function LeftSidebar({ objects, selectedId, onSelect, onAddPerson, onAddPrimitive, onImport, onToggleVisible, onToggleLock, shots, activeShotId, onSelectShot, onAddShot, onDuplicateShot, onDeleteShot, onRenameShot, onCaptureShot }) {
  const [tab, setTab] = useState('assets')
  const inputRef = useRef(null)
  return (
    <aside className="left-sidebar panel">
      <div className="panel-tabs">
        <button className={tab === 'assets' ? 'is-active' : ''} onClick={() => setTab('assets')}>资源库</button>
        <button className={tab === 'scene' ? 'is-active' : ''} onClick={() => setTab('scene')}>场景层级</button>
        <button className={tab === 'shots' ? 'is-active' : ''} onClick={() => setTab('shots')}>镜头</button>
      </div>
      {tab === 'assets' ? (
        <div className="assets-scroll">
          <div className="section-kicker">人物体型</div>
          <AssetCard icon={UserRound} title="标准人物" subtitle="中性比例 · 可换动作" onClick={() => onAddPerson('standard')} previewClass="person-preview" />
          <AssetCard icon={UserRound} title="女性人体" subtitle="窄肩宽髋 · 真人比例" onClick={() => onAddPerson('female')} previewClass="person-preview female" />
          <AssetCard icon={UserRound} title="男性人体" subtitle="宽肩躯干 · 真人比例" onClick={() => onAddPerson('male')} previewClass="person-preview male" />
          <AssetCard icon={UserRound} title="修长人物" subtitle="高挑比例 · 适合走位" onClick={() => onAddPerson('tall')} previewClass="person-preview tall" />
          <AssetCard icon={UserRound} title="宽体人物" subtitle="厚重比例 · 强轮廓" onClick={() => onAddPerson('broad')} previewClass="person-preview broad" />
          <div className="section-kicker section-gap">基础物体</div>
          <div className="primitive-grid">
            <button onClick={() => onAddPrimitive('box')}><Box size={24} /><span>方块</span></button>
            <button onClick={() => onAddPrimitive('sphere')}><CircleDot size={24} /><span>球体</span></button>
            <button onClick={() => onAddPrimitive('cylinder')}><CircleDot size={24} /><span>圆柱</span></button>
            <button onClick={() => onAddPrimitive('plane')}><Grid3X3 size={24} /><span>平面</span></button>
          </div>
          <div className="section-kicker section-gap">场景粗模</div>
          <div className="primitive-grid blockout-grid">
            {[['arch', '拱门'], ['stairs', '楼梯'], ['door', '门'], ['window', '窗'], ['table', '桌子'], ['chair', '椅子'], ['sofa', '沙发'], ['roof', '屋顶'], ['tree', '树木'], ['vehicle', '车辆']].map(([type, label]) => (
              <button key={type} onClick={() => onAddPrimitive(type)}><Box size={20} /><span>{label}</span></button>
            ))}
          </div>
          <div className="section-kicker section-gap">外部模型</div>
          <button className="import-drop" onClick={() => inputRef.current?.click()}>
            <Import size={18} /><strong>导入 GLB / GLTF</strong><span>导入本地三维模型</span>
          </button>
          <input ref={inputRef} className="visually-hidden" type="file" accept=".glb,.gltf" onChange={onImport} />
        </div>
      ) : tab === 'scene' ? (
        <SceneList objects={objects} selectedId={selectedId} onSelect={onSelect} onToggleVisible={onToggleVisible} onToggleLock={onToggleLock} />
      ) : <ShotsPanel shots={shots} activeShotId={activeShotId} onSelect={onSelectShot} onAdd={onAddShot} onDuplicate={onDuplicateShot} onDelete={onDeleteShot} onRename={onRenameShot} onCapture={onCaptureShot} />}
    </aside>
  )
}

function Inspector({ selected, camera, selectedJoint, customPoses, onSelectJoint, onUpdateObject, onUpdateCamera, onDelete, onDuplicate, onFocus, onToggleLock, onSaveCustomPose, onApplyCustomPose, onDeleteCustomPose }) {
  if (!selected) {
    return <aside className="right-sidebar panel empty-inspector"><MousePointer2 size={24} /><span>选择场景中的物体</span></aside>
  }
  const isCamera = selected.id === CAMERA_ID
  const position = isCamera ? camera.position : selected.position
  const typeLabel = selected.type === 'depthMesh' ? 'DEPTH SPACE' : selected.type?.toUpperCase()
  const rigPose = selected.type === 'person' ? poseForObject(selected) : null
  const canLoopPose = selected.type === 'person' && poseCanLoop(selected.pose)
  const jointRotation = rigPose?.joints[selectedJoint] || [0, 0, 0]
  const updateJoint = rotation => onUpdateObject({
    joints: { ...rigPose.joints, [selectedJoint]: rotation },
  })
  const applyPreset = pose => onUpdateObject({
    pose: normalizePoseId(pose),
    poseTime: presetPhase(pose),
    continuousMotion: poseCanLoop(pose) ? Boolean(selected.continuousMotion) : false,
    rigRoot: presetRoot(),
    joints: presetJoints(),
  })
  return (
    <aside className="right-sidebar panel">
      <div className="inspector-head">
        <div><small>{isCamera ? 'CAMERA' : typeLabel}</small>{isCamera ? <strong>主摄像机</strong> : <input className="inspector-name-input" value={selected.name} onChange={event => onUpdateObject({ name: event.target.value })} aria-label="物体名称" />}</div>
        <div className="inspector-head-actions">
          <ToolButton icon={Focus} label="视图聚焦" onClick={onFocus} />
          {!isCamera && <ToolButton icon={selected.locked ? Unlock : Lock} label={selected.locked ? '解除锁定' : '锁定'} onClick={onToggleLock} />}
          {!isCamera && <ToolButton icon={Copy} label="复制" onClick={onDuplicate} />}
          {!isCamera && <ToolButton icon={Trash2} label="删除" onClick={onDelete} />}
        </div>
      </div>
      <div className="inspector-scroll">
        {!isCamera && selected.locked && <div className="locked-banner"><Lock size={12} /> 已锁定空间变换</div>}
        <div className="inspector-section">
          <div className="section-title"><span>变换</span><ChevronDown size={14} /></div>
          <VectorFields title="位置" value={position} onChange={value => isCamera ? onUpdateCamera({ position: value }) : onUpdateObject({ position: value })} disabled={!isCamera && selected.locked} />
          {isCamera
            ? <VectorFields title="摄像机旋转 · X 俯仰 / Y 水平 / Z 翻滚" value={camera.rotation} degrees onChange={rotation => onUpdateCamera({ rotation })} />
            : <VectorFields title={selected.type === 'person' ? '整体旋转 · X 纵向 / Y 水平 / Z 翻滚' : '旋转'} value={selected.rotation} degrees onChange={rotation => onUpdateObject({ rotation })} disabled={selected.locked} />}
          {!isCamera && <VectorFields
            title="缩放"
            kind="scale"
            value={selected.scale}
            proportionalScale={Boolean(selected.proportionalScale)}
            scaleAxisLocks={Array.isArray(selected.scaleAxisLocks) ? selected.scaleAxisLocks : [false, false, false]}
            onToggleProportionalScale={() => onUpdateObject({ proportionalScale: !selected.proportionalScale })}
            onToggleScaleAxis={axis => {
              const locks = Array.isArray(selected.scaleAxisLocks) ? [...selected.scaleAxisLocks] : [false, false, false]
              locks[axis] = !locks[axis]
              onUpdateObject({ scaleAxisLocks: locks })
            }}
            onChange={scale => onUpdateObject({ scale })}
            disabled={selected.locked}
          />}
        </div>
        {isCamera ? (
          <div className="inspector-section">
            <div className="section-title"><span>镜头</span><ChevronDown size={14} /></div>
            <label className="range-field"><span>焦距</span><input type="range" min="18" max="120" value={camera.focalLength} onChange={e => onUpdateCamera({ focalLength: Number(e.target.value) })} /><output>{Math.round(camera.focalLength)} mm</output></label>
            <div className="focal-presets" aria-label="常用焦距">
              {FOCAL_LENGTH_PRESETS.map(value => <button type="button" key={value} className={Math.round(camera.focalLength) === value ? 'is-active' : ''} onClick={() => onUpdateCamera({ focalLength: value })}>{value}</button>)}
            </div>
            <div className="camera-info"><span>传感器</span><strong>全画幅 36 mm</strong></div>
            <label className="select-field aspect-field"><span>画面比例</span><select value={camera.aspectRatio || '16:9'} onChange={e => onUpdateCamera({ aspectRatio: e.target.value })}>{ASPECT_RATIOS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          </div>
        ) : selected.type === 'person' ? (
          <div className="inspector-section">
            <div className="section-title"><span>人物</span><ChevronDown size={14} /></div>
            <label className="select-field"><span>体型</span><select value={selected.bodyType} onChange={e => onUpdateObject({ bodyType: e.target.value })}><option value="standard">中性人体</option><option value="female">女性人体</option><option value="male">男性人体</option><option value="tall">修长人体</option><option value="broad">宽体人体</option></select></label>
            <label className="select-field"><span>动作预设</span><select value={normalizePoseId(selected.pose)} onChange={e => applyPreset(e.target.value)}>{RIG_PRESET_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className="range-field pose-time-field"><span>动作相位</span><input type="range" min="0" max="1" step="0.01" value={Number.isFinite(selected.poseTime) ? selected.poseTime : presetPhase(selected.pose)} onChange={e => onUpdateObject({ poseTime: Number(e.target.value) })} /><output>{Math.round((Number.isFinite(selected.poseTime) ? selected.poseTime : presetPhase(selected.pose)) * 100)}%</output></label>
            <label className={`motion-loop-control ${canLoopPose ? '' : 'is-disabled'}`}>
              <input type="checkbox" checked={canLoopPose && Boolean(selected.continuousMotion)} disabled={!canLoopPose} onChange={event => onUpdateObject({ continuousMotion: event.target.checked })} />
              <span><strong>随时间轴循环动作</strong><small>{canLoopPose ? '播放、拖帧和导出时持续循环' : '当前预设是固定姿势，不支持循环'}</small></span>
            </label>
            <p className="pose-source-note">角色状态关键帧会记录动作、相位、循环开关和完整骨骼，并在对应帧切换。动作来源：Three.js X-Bot 与 CC0 日常动作；当前模型没有面部表情。</p>
            <div className="pose-library">
              <div className="pose-library-head"><span>动作库</span><small>{RIG_PRESET_OPTIONS.length} PRESETS</small></div>
              {RIG_PRESET_GROUPS.map(group => (
                <div className="pose-group" key={group.label}>
                  <div className="pose-group-label">{group.label}</div>
                  <div className="pose-grid">
                    {group.poses.map(([value, label]) => (
                      <button key={value} type="button" data-pose={value} className={selected.pose === value ? 'is-active' : ''} onClick={() => applyPreset(value)} title={`${group.label} · ${label}`}>
                        <span className="pose-figure"><i /><i /><i /></span>
                        <strong>{label}</strong>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="joint-editor">
              <div className="joint-editor-head"><span>完整骨骼</span><small>{JOINT_DEFINITIONS.length} 根均可旋转</small></div>
              <label className="select-field"><span>当前骨骼</span><select value={selectedJoint} onChange={event => onSelectJoint(event.target.value)}>{JOINT_GROUPS.map(group => <optgroup key={group.label} label={group.label}>{group.joints.map(joint => <option key={joint.id} value={joint.id}>{joint.label}</option>)}</optgroup>)}</select></label>
              <VectorFields title="关节旋转" value={jointRotation} degrees onChange={updateJoint} />
              <button type="button" className="joint-reset-button" onClick={() => updateJoint([0, 0, 0])}>重置当前关节</button>
              <button type="button" className="joint-reset-button" onClick={() => onUpdateObject({ joints: presetJoints() })}>重置全部骨骼</button>
              <p className="joint-editor-hint">按 Q 后拖动青绿色的手脚控制点可摆放四肢末端；拖动人物其他部位或金色骨骼点可旋转单根骨骼。按住 Shift 左右拖可调整单骨骼扭转，也可使用 X/Y/Z 滑块微调。</p>
              <label className="foot-lock-control">
                <input type="checkbox" checked={Boolean(selected.footLock)} onChange={event => onUpdateObject({ footLock: event.target.checked })} />
                <span><strong>脚底锁定</strong><small>脚部 IK 保持当前脚底高度，只沿地面拖动</small></span>
              </label>
            </div>
            <div className="custom-pose-library">
              <div className="joint-editor-head"><span>我的姿势</span><small>{customPoses.length} SAVED</small></div>
              <button type="button" className="save-custom-pose" onClick={() => onSaveCustomPose(selected)}><Save size={12} /> 保存当前姿势</button>
              {customPoses.length ? (
                <div className="custom-pose-list">
                  {customPoses.map(customPose => (
                    <div className="custom-pose-row" key={customPose.id}>
                      <button type="button" onClick={() => onApplyCustomPose(customPose)} title={`应用“${customPose.name}”`}>{customPose.name}</button>
                      <button type="button" className="custom-pose-delete" onClick={() => onDeleteCustomPose(customPose.id)} title={`删除“${customPose.name}”`} aria-label={`删除“${customPose.name}”`}><Trash2 size={11} /></button>
                    </div>
                  ))}
                </div>
              ) : <p className="custom-pose-empty">还没有保存的姿势。调整骨骼后可存入本机姿势库。</p>}
            </div>
            <label className="color-field person-color-field"><span>人物颜色</span><input type="color" value={selected.color || '#e8e3d8'} onChange={e => onUpdateObject({ color: e.target.value })} /><output>{selected.color || '#e8e3d8'}</output></label>
          </div>
        ) : (
          <div className="inspector-section">
            <div className="section-title"><span>外观</span><ChevronDown size={14} /></div>
            <label className="color-field"><span>白模材质</span><input type="color" value={selected.color || '#d8d3c8'} onChange={e => onUpdateObject({ color: e.target.value })} /><output>{selected.color || '#d8d3c8'}</output></label>
          </div>
        )}
      </div>
    </aside>
  )
}

function ProjectSettingsDialog({ settings, onApply, onClose }) {
  const [draft, setDraft] = useState(settings)
  const totalFrames = Number(draft.fps) * Number(draft.durationSeconds)
  const submit = event => {
    event.preventDefault()
    onApply(normalizeProjectSettings(draft))
  }
  return (
    <div className="settings-overlay" role="presentation" onPointerDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <form className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="project-settings-title" onSubmit={submit}>
        <div className="settings-dialog-head">
          <div><Settings2 size={17} /><span><strong id="project-settings-title">镜头设置</strong><small>工程时间与播放</small></span></div>
          <button type="button" onClick={onClose} aria-label="关闭镜头设置">关闭</button>
        </div>
        <div className="settings-fields">
          <label><span>工程名称</span><input autoFocus value={draft.name} maxLength="40" onChange={event => setDraft(current => ({ ...current, name: event.target.value }))} /></label>
          <div className="settings-field-row">
            <label><span>帧率</span><select value={draft.fps} onChange={event => setDraft(current => ({ ...current, fps: Number(event.target.value) }))}>{FPS_OPTIONS.map(value => <option value={value} key={value}>{value} FPS</option>)}</select></label>
            <label><span>镜头时长</span><div className="duration-input"><input type="number" min="1" max="60" step="1" value={draft.durationSeconds} onChange={event => setDraft(current => ({ ...current, durationSeconds: event.target.value }))} /><i>秒</i></div></label>
          </div>
          <div className="settings-summary"><span>时间轴范围</span><strong>0–{Number.isFinite(totalFrames) ? totalFrames : 0} 帧</strong><small>{draft.fps || 0} FPS · 最长 60 秒</small></div>
          <label className="settings-toggle"><input type="checkbox" checked={Boolean(draft.loopPlayback)} onChange={event => setDraft(current => ({ ...current, loopPlayback: event.target.checked }))} /><span><strong>循环播放</strong><small>到达镜头结尾后自动从第 0 帧继续</small></span></label>
        </div>
        <div className="settings-dialog-actions"><button type="button" onClick={onClose}>取消</button><button type="submit">应用设置</button></div>
      </form>
    </div>
  )
}

function Timeline({ currentFrame, fps, totalFrames, onSeek, playing, onTogglePlay, keyframes, onAddKeyframe, onDeleteKeyframe, objectTrack, onAddObjectKeyframe, onDeleteObjectKeyframe, selectedKeyframe, onSelectKeyframe, onMoveKeyframe, onCopyKeyframe, onPasteKeyframe, onDeleteSelectedKeyframe, onChangeInterpolation, hasClipboard }) {
  const [dragging, setDragging] = useState(null)
  const rulerFrames = useMemo(() => [...new Set(Array.from({ length: 6 }, (_, index) => Math.round(totalFrames * index / 5)))], [totalFrames])
  const scrub = useCallback((event, rect) => {
    onSeek(Math.round(clamp((event.clientX - rect.left) / rect.width, 0, 1) * totalFrames))
  }, [onSeek, totalFrames])
  const onPointerDown = event => {
    const rect = event.currentTarget.getBoundingClientRect()
    scrub(event, rect)
    const move = moveEvent => scrub(moveEvent, rect)
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const beginKeyDrag = (event, key, kind, trackId) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const rect = event.currentTarget.parentElement.getBoundingClientRect()
    let toFrame = key.frame
    onSeek(key.frame)
    onSelectKeyframe({ kind, frame: key.frame, trackId })
    setDragging({ kind, trackId, fromFrame: key.frame, toFrame })
    const move = moveEvent => {
      toFrame = Math.round(clamp((moveEvent.clientX - rect.left) / rect.width, 0, 1) * totalFrames)
      setDragging({ kind, trackId, fromFrame: key.frame, toFrame })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setDragging(null)
      if (toFrame !== key.frame) onMoveKeyframe({ kind, trackId, fromFrame: key.frame, toFrame })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const renderTrack = (frames, kind, onDelete, trackId = null) => (
    <div className={`track ${kind}-track`} onPointerDown={onPointerDown}>
      <div className="track-fill" style={{ width: `${currentFrame / totalFrames * 100}%` }} />
      {!frames.length && <span className="empty-track-note">暂无关键帧</span>}
      {frames.map(key => {
        const isDragged = dragging?.kind === kind && dragging?.trackId === trackId && dragging?.fromFrame === key.frame
        const displayFrame = isDragged ? dragging.toFrame : key.frame
        const isSelected = selectedKeyframe?.kind === kind && selectedKeyframe?.trackId === trackId && selectedKeyframe?.frame === key.frame
        const stateCopy = kind === 'object' && objectTrack?.type === 'person' ? ` · ${poseLabel(key.pose)}${key.continuousMotion ? '（持续）' : ''}` : ''
        const title = `第 ${key.frame} 帧${stateCopy} · ${normalizeInterpolation(key.interpolation) === 'smooth' ? '平滑' : normalizeInterpolation(key.interpolation) === 'linear' ? '线性' : '保持'} · 拖动可移动`
        return <button key={key.frame} className={`keyframe ${kind} ${key.frame === currentFrame ? 'is-current' : ''} ${isSelected ? 'is-selected' : ''}`} data-interpolation={normalizeInterpolation(key.interpolation)} style={{ left: `${displayFrame / totalFrames * 100}%` }} title={title} aria-label={title} onPointerDown={event => beginKeyDrag(event, key, kind, trackId)} onDoubleClick={event => { event.stopPropagation(); onDelete(key.frame); onSelectKeyframe(null) }} />
      })}
      <div className="playhead" style={{ left: `${currentFrame / totalFrames * 100}%` }}><i /></div>
    </div>
  )
  return (
    <section className="timeline panel">
      <div className="timeline-controls">
        <ToolButton icon={SkipBack} label="回到开头" onClick={() => onSeek(0)} />
        <button className={`play-button ${playing ? 'is-playing' : ''}`} onClick={onTogglePlay}>{playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}</button>
        <ToolButton icon={SkipForward} label="跳到结尾" onClick={() => onSeek(totalFrames)} />
        <div className="time-readout"><strong>{String(currentFrame).padStart(3, '0')}</strong><span>/ {totalFrames} 帧 · {fps} FPS</span></div>
        <div className="timeline-key-editor">
          {selectedKeyframe ? (
            <>
              <span>{selectedKeyframe.kind === 'camera' ? '镜头' : objectTrack?.type === 'person' ? '角色状态' : '物体'} · {selectedKeyframe.frame} 帧</span>
              <select value={selectedKeyframe.interpolation} onChange={event => onChangeInterpolation(event.target.value)} title="插值方式">
                <option value="smooth">平滑</option>
                <option value="linear">线性</option>
                <option value="hold">保持</option>
              </select>
              <div><button onClick={onCopyKeyframe} title="复制关键帧"><Copy size={12} /></button><button onClick={onPasteKeyframe} disabled={!hasClipboard} title="粘贴到当前帧"><Plus size={12} /></button><button onClick={onDeleteSelectedKeyframe} title="删除关键帧"><Trash2 size={12} /></button></div>
            </>
          ) : <span className="timeline-key-empty">点击关键帧进行编辑</span>}
        </div>
      </div>
      <div className="timeline-body">
        <div className="ruler timeline-ruler">{rulerFrames.map(frame => <span key={frame} style={{ left: `${frame / totalFrames * 100}%` }}>{frame}</span>)}</div>
        <div className="track-label camera-track-label"><Camera size={13} /><span>主摄像机</span></div>
        <div className="camera-track-slot">{renderTrack(keyframes, 'camera', onDeleteKeyframe)}</div>
        <button className="keyframe-button camera-keyframe-button" onClick={onAddKeyframe}><Plus size={13} /> 镜头关键帧</button>
        {objectTrack && (
          <>
            <div className="track-label object-track-label">{objectTrack.type === 'person' ? <UserRound size={13} /> : <Box size={13} />}<span>{objectTrack.name}</span></div>
            <div className="object-track-slot">{renderTrack(objectTrack.keyframes, 'object', onDeleteObjectKeyframe, objectTrack.id)}</div>
            <button className="keyframe-button object-keyframe-button" onClick={onAddObjectKeyframe}><Plus size={13} /> {objectTrack.type === 'person' ? '角色状态关键帧' : '物体关键帧'}</button>
          </>
        )}
      </div>
    </section>
  )
}

function referenceImageFromFile(file) {
  return new Promise((resolve, reject) => {
    if (!file?.type?.startsWith('image/')) { reject(new Error('请选择图片文件')); return }
    if (file.size > 20 * 1024 * 1024) { reject(new Error('参考图不能超过 20 MB')); return }
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('图片读取失败'))
    reader.onload = () => {
      const image = new Image()
      image.onerror = () => reject(new Error('图片格式无法读取'))
      image.onload = () => {
        const longest = Math.max(image.naturalWidth, image.naturalHeight)
        const ratio = Math.min(1, 1600 / Math.max(1, longest))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio))
        canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio))
        const context = canvas.getContext('2d')
        context.fillStyle = '#e8e6df'
        context.fillRect(0, 0, canvas.width, canvas.height)
        context.drawImage(image, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', 0.84))
      }
      image.src = reader.result
    }
    reader.readAsDataURL(file)
  })
}

function referenceCanvasForExport(reference, width, height) {
  return new Promise((resolve, reject) => {
    if (!reference?.image || !reference.includeInExport) return resolve(null)
    const image = new Image()
    image.onerror = () => reject(new Error('参考图无法加入导出画面'))
    image.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d')
      context.fillStyle = '#9b9c98'
      context.fillRect(0, 0, width, height)
      context.imageSmoothingEnabled = true
      context.imageSmoothingQuality = 'high'
      const drawWidth = width * 0.72 * reference.scale
      const drawHeight = drawWidth * image.naturalHeight / Math.max(1, image.naturalWidth)
      const centerX = width * (0.5 + reference.x / 100)
      const centerY = height * (0.5 + reference.y / 100)
      context.globalAlpha = reference.opacity
      context.drawImage(image, centerX - drawWidth / 2, centerY - drawHeight / 2, drawWidth, drawHeight)
      context.globalAlpha = 1
      resolve(canvas)
    }
    image.src = reference.image
  })
}

function ReferenceOverlay({ reference, onChange, onToast, cameraMode = false, cameraAspect = 16 / 9, children }) {
  const inputRef = useRef(null)
  const dragRef = useRef(null)
  const [editing, setEditing] = useState(false)
  const [expanded, setExpanded] = useState(true)
  const update = patch => onChange(current => normalizeReference({ ...current, ...patch }))
  const upload = async event => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const image = await referenceImageFromFile(file)
      onChange(normalizeReference({ ...DEFAULT_REFERENCE, image, name: file.name }))
      setEditing(false)
      setExpanded(true)
      onToast(`参考图“${file.name}”已加入 · 可切换到“摄像机视角”核对导出构图`)
    } catch (error) {
      onToast(error.message || '参考图上传失败')
    }
  }
  const beginDrag = event => {
    if (!editing) return
    event.preventDefault()
    event.stopPropagation()
    const bounds = event.currentTarget.parentElement.getBoundingClientRect()
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: reference.x, y: reference.y, width: bounds.width, height: bounds.height }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }
  const moveDrag = event => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    update({
      x: drag.x + (event.clientX - drag.startX) / Math.max(1, drag.width) * 100,
      y: drag.y + (event.clientY - drag.startY) / Math.max(1, drag.height) * 100,
    })
  }
  const endDrag = event => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = null
    event.currentTarget.releasePointerCapture?.(event.pointerId)
  }
  const hasImage = Boolean(reference.image)
  const referenceLayer = hasImage && (cameraMode ? reference.includeInExport : reference.visible) ? (
    <div className={`reference-layer ${editing ? 'is-editing' : ''}`} aria-label={`参考图 ${reference.name}`}>
      <img
        src={reference.image}
        alt={reference.name || '动作参考图'}
        draggable="false"
        style={{ left: `${50 + reference.x}%`, top: `${50 + reference.y}%`, width: `${72 * reference.scale}%`, opacity: reference.opacity }}
        onPointerDown={beginDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      />
    </div>
  ) : null
  return (
    <>
      <div className={`reference-panel floating-panel ${hasImage ? 'has-image' : ''} ${hasImage && !expanded ? 'is-collapsed' : ''}`}>
        <input ref={inputRef} className="visually-hidden" type="file" accept="image/png,image/jpeg,image/webp" onChange={upload} />
        {hasImage && !expanded ? (
          <button type="button" className="reference-expand" title="展开参考图工具" aria-label="展开参考图工具" onClick={() => setExpanded(true)}><FileImage size={13} /><ChevronDown size={11} /></button>
        ) : (
          <>
            <button type="button" className="reference-upload" onClick={() => inputRef.current?.click()}><FileImage size={13} /> {hasImage ? '更换参考图' : '上传参考图'}</button>
            {hasImage && (
              <>
                <button type="button" className={reference.visible ? 'is-active' : ''} onClick={() => update({ visible: !reference.visible })}>{reference.visible ? '隐藏' : '显示'}</button>
                <button type="button" className={editing ? 'is-active' : ''} onClick={() => { setEditing(value => !value); update({ visible: true }) }}><Move3D size={12} /> {editing ? '锁定' : '移动图'}</button>
                <button type="button" title="移除参考图" aria-label="移除参考图" onClick={() => { onChange(cloneProjectValue(DEFAULT_REFERENCE)); setEditing(false); setExpanded(true) }}><Trash2 size={12} /></button>
                <label><span>透明</span><input aria-label="参考图透明度" type="range" min="0.1" max="1" step="0.05" value={reference.opacity} onChange={event => update({ opacity: Number(event.target.value) })} /></label>
                <label><span>大小</span><input aria-label="参考图大小" type="range" min="0.25" max="2" step="0.05" value={reference.scale} onChange={event => update({ scale: Number(event.target.value) })} /></label>
                <label className="reference-export-toggle"><input aria-label="参考图随 PNG 和 MP4 导出" type="checkbox" checked={reference.includeInExport} onChange={event => update({ includeInExport: event.target.checked })} /><span>进入导出</span></label>
                <button type="button" onClick={() => update({ x: 0, y: 0, scale: 1 })}>居中</button>
                <button type="button" title="收起参考图工具" aria-label="收起参考图工具" onClick={() => { setExpanded(false); setEditing(false) }}><ChevronUp size={12} /></button>
              </>
            )}
          </>
        )}
      </div>
      {cameraMode ? (
        <div className="camera-edit-frame">
          <div className="camera-edit-stage" style={{ aspectRatio: cameraAspect, '--camera-aspect': cameraAspect }}>
            {referenceLayer}
            {children}
          </div>
        </div>
      ) : <>{referenceLayer}{children}</>}
    </>
  )
}

export default function App() {
  const startupProject = useMemo(() => readCachedProject(), [])
  const [settings, setSettings] = useState(() => normalizeProjectSettings(startupProject?.settings))
  const [shots, setShots] = useState(() => startupProject?.shots || [{
    id: 'shot-01', name: '镜头 01', thumbnail: '', fps: DEFAULT_PROJECT_SETTINGS.fps, durationSeconds: DEFAULT_PROJECT_SETTINGS.durationSeconds, loopPlayback: false,
    objects: cloneProjectValue(initialObjects), camera: cloneProjectValue(initialCamera), reference: cloneProjectValue(DEFAULT_REFERENCE), keyframes: [], objectKeyframes: {},
  }])
  const [activeShotId, setActiveShotId] = useState(() => startupProject?.activeShotId || 'shot-01')
  const [objects, setObjects] = useState(() => startupProject?.objects || initialObjects)
  const [selectedId, setSelectedId] = useState(() => startupProject?.objects?.[0]?.id || 'actor-lead')
  const [selectedJoint, setSelectedJoint] = useState('mixamorigSpine2')
  const [transformMode, setTransformMode] = useState('translate')
  const [camera, setCamera] = useState(() => ({ ...initialCamera, ...(startupProject?.camera || {}) }))
  const [reference, setReference] = useState(() => normalizeReference(startupProject?.reference))
  const [keyframes, setKeyframes] = useState(() => startupProject?.keyframes || initialKeyframes)
  const [characterKeyframes, setCharacterKeyframes] = useState(() => startupProject?.objectKeyframes || startupProject?.characterKeyframes || initialCharacterKeyframes)
  const [objectDrafts, setObjectDrafts] = useState({})
  const [currentFrame, setCurrentFrame] = useState(0)
  const [selectedKeyframe, setSelectedKeyframe] = useState(null)
  const [keyframeClipboard, setKeyframeClipboard] = useState(null)
  const [customPoses, setCustomPoses] = useState(() => readCustomPoses())
  const [playing, setPlaying] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [capturingImage, setCapturingImage] = useState(false)
  const [exportReferenceBackground, setExportReferenceBackground] = useState(null)
  const [monitorReferenceBackground, setMonitorReferenceBackground] = useState(null)
  const [exportProgress, setExportProgress] = useState(0)
  const [showGrid, setShowGrid] = useState(true)
  const [cameraView, setCameraView] = useState(false)
  const [editorView, setEditorView] = useState({ position: [8.5, 6.4, 9.5], target: [0, 1, 0] })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [viewFocusRequest, setViewFocusRequest] = useState(null)
  const [toast, setToast] = useState('')
  const [saveStatus, setSaveStatus] = useState(startupProject ? '已恢复自动保存' : '自动保存已开启')
  const [, setHistoryVersion] = useState(0)
  const loadRef = useRef(null)
  const playStartRef = useRef(null)
  const currentFrameRef = useRef(0)
  const exportCanvasRef = useRef(null)
  const imageCaptureCanvasRef = useRef(null)
  const monitorCanvasRef = useRef(null)
  const editorViewRef = useRef(editorView)
  const exportLockRef = useRef(false)
  const historyRef = useRef({ past: [], future: [], last: '', timer: null, restoring: false })
  const latestProjectRef = useRef(null)

  const fps = settings.fps
  const totalFrames = fps * settings.durationSeconds

  const selected = useMemo(() => selectedId === CAMERA_ID ? { id: CAMERA_ID } : objects.find(object => object.id === selectedId), [objects, selectedId])
  const activeObject = useMemo(() => selected?.id && selected.id !== CAMERA_ID ? selected : null, [selected])
  const activeShot = useMemo(() => shots.find(shot => shot.id === activeShotId) || shots[0], [activeShotId, shots])
  const displayedShots = useMemo(() => shots.map(shot => shot.id === activeShotId ? {
    ...shot,
    fps: settings.fps,
    durationSeconds: settings.durationSeconds,
    loopPlayback: settings.loopPlayback,
    objects,
    camera,
    reference,
    keyframes,
    objectKeyframes: characterKeyframes,
  } : shot), [activeShotId, camera, characterKeyframes, keyframes, objects, reference, settings.durationSeconds, settings.fps, settings.loopPlayback, shots])
  const maxKeyframeFrame = useMemo(() => Math.max(0, ...keyframes.map(key => key.frame), ...Object.values(characterKeyframes).flatMap(track => (track || []).map(key => key.frame))), [characterKeyframes, keyframes])
  const selectedKeyframeInfo = useMemo(() => {
    if (!selectedKeyframe) return null
    const track = selectedKeyframe.kind === 'camera' ? keyframes : characterKeyframes[selectedKeyframe.trackId]
    const key = track?.find(item => item.frame === selectedKeyframe.frame)
    return key ? { ...selectedKeyframe, interpolation: normalizeInterpolation(key.interpolation) } : null
  }, [characterKeyframes, keyframes, selectedKeyframe])
  const animatedCamera = useMemo(() => keyframes.length ? cameraAtFrame(keyframes, currentFrame, camera.aspectRatio) : camera, [keyframes, currentFrame, camera])
  const isAnimating = playing || exporting
  const hasObjectAnimation = useMemo(() => Object.values(characterKeyframes).some(track => track?.length), [characterKeyframes])
  const animatedObjects = useMemo(() => {
    const framedObjects = hasObjectAnimation ? objectsAtFrame(objects, characterKeyframes, currentFrame, fps) : objects
    return framedObjects.map(object => objectDrafts[object.id] || object)
  }, [hasObjectAnimation, objects, characterKeyframes, currentFrame, fps, objectDrafts])
  const inspectorSelected = useMemo(() => selectedId === CAMERA_ID ? selected : animatedObjects.find(object => object.id === selectedId), [animatedObjects, selected, selectedId])
  const displayCamera = isAnimating ? animatedCamera : camera
  const previewAspect = aspectValue(displayCamera.aspectRatio)
  const previewAspectClass = previewAspect >= 16 / 9 ? 'is-wide' : 'is-tall'
  const exportDimensions = useMemo(() => exportDimensionsForAspect(camera.aspectRatio), [camera.aspectRatio])
  const currentProject = useMemo(() => projectData({
    settings,
    objects,
    camera,
    reference,
    keyframes,
    objectKeyframes: characterKeyframes,
    shots,
    activeShotId,
  }), [settings, objects, camera, reference, keyframes, characterKeyframes, shots, activeShotId])

  useEffect(() => {
    currentFrameRef.current = currentFrame
  }, [currentFrame])

  useEffect(() => {
    let active = true
    if (!reference.image || !reference.includeInExport) {
      setMonitorReferenceBackground(null)
      return () => { active = false }
    }
    referenceCanvasForExport(reference, exportDimensions.width, exportDimensions.height)
      .then(canvas => { if (active) setMonitorReferenceBackground(canvas) })
      .catch(() => { if (active) setMonitorReferenceBackground(null) })
    return () => { active = false }
  }, [exportDimensions.height, exportDimensions.width, reference])

  useEffect(() => {
    try { localStorage.setItem(CUSTOM_POSE_STORAGE_KEY, JSON.stringify(customPoses)) } catch { /* 姿势库写入失败时不影响工程编辑 */ }
  }, [customPoses])

  useEffect(() => {
    if (selectedKeyframe?.kind === 'object' && selectedKeyframe.trackId !== selectedId) setSelectedKeyframe(null)
  }, [selectedId, selectedKeyframe])

  useEffect(() => {
    latestProjectRef.current = currentProject
    const history = historyRef.current
    if (!history.last) {
      history.last = currentProject
      return
    }
    if (history.restoring) {
      history.restoring = false
      history.last = currentProject
      return
    }
    clearTimeout(history.timer)
    const previous = history.last
    history.timer = setTimeout(() => {
      if (latestProjectRef.current === previous) return
      history.past.push(previous)
      if (history.past.length > 50) history.past.shift()
      history.last = latestProjectRef.current
      history.future = []
      setHistoryVersion(version => version + 1)
    }, 280)
    return () => clearTimeout(history.timer)
  }, [currentProject])

  useEffect(() => {
    setSaveStatus('保存中…')
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(PROJECT_STORAGE_KEY, JSON.stringify(currentProject))
        setSaveStatus('已自动保存')
      } catch {
        setSaveStatus('自动保存空间不足')
      }
    }, 900)
    return () => clearTimeout(timer)
  }, [currentProject])

  const applyProjectSnapshot = useCallback(snapshot => {
    const normalized = normalizeProjectData(snapshot)
    if (!normalized) return
    setSettings(normalized.settings)
    setShots(normalized.shots)
    setActiveShotId(normalized.activeShotId)
    setObjects(normalized.objects)
    setCamera(normalized.camera)
    setReference(normalized.reference)
    setKeyframes(normalized.keyframes)
    setCharacterKeyframes(normalized.objectKeyframes)
    setObjectDrafts({})
    setSelectedKeyframe(null)
    setPlaying(false)
    setCurrentFrame(frame => {
      const nextFrame = clamp(frame, 0, normalized.settings.fps * normalized.settings.durationSeconds)
      currentFrameRef.current = nextFrame
      return nextFrame
    })
    setSelectedId(current => current === CAMERA_ID || normalized.objects.some(object => object.id === current) ? current : normalized.objects[0]?.id || CAMERA_ID)
  }, [])

  const flushHistory = useCallback(() => {
    const history = historyRef.current
    clearTimeout(history.timer)
    const latest = latestProjectRef.current
    if (history.last && latest && latest !== history.last) {
      history.past.push(history.last)
      if (history.past.length > 50) history.past.shift()
      history.last = latest
      history.future = []
    }
  }, [])

  const undo = useCallback(() => {
    flushHistory()
    const history = historyRef.current
    const previous = history.past.pop()
    if (!previous) return
    history.future.push(history.last)
    history.last = previous
    history.restoring = true
    applyProjectSnapshot(previous)
    setHistoryVersion(version => version + 1)
    setToast('已撤销')
  }, [applyProjectSnapshot, flushHistory])

  const redo = useCallback(() => {
    const history = historyRef.current
    const next = history.future.pop()
    if (!next) return
    history.past.push(history.last)
    history.last = next
    history.restoring = true
    applyProjectSnapshot(next)
    setHistoryVersion(version => version + 1)
    setToast('已重做')
  }, [applyProjectSnapshot])

  const focusSelected = useCallback(() => {
    if (selectedId === CAMERA_ID) {
      setViewFocusRequest({ position: [...displayCamera.position], height: 0, distance: 4, nonce: Date.now() })
      return
    }
    const object = animatedObjects.find(item => item.id === selectedId)
    if (!object) return
    const maxScale = Math.max(...(object.scale || [1, 1, 1]).map(value => Math.abs(value) || 1))
    setViewFocusRequest({
      position: visualCenterForObject(object),
      height: 0,
      distance: clamp(maxScale * 4.5, 2.8, 14),
      nonce: Date.now(),
    })
  }, [animatedObjects, displayCamera.position, selectedId])

  const seekToFrame = useCallback(frame => {
    const nextFrame = clamp(Math.round(frame), 0, totalFrames)
    setPlaying(false)
    setObjectDrafts({})
    setCurrentFrame(nextFrame)
    currentFrameRef.current = nextFrame
    if (keyframes.length) setCamera(cameraAtFrame(keyframes, nextFrame, camera.aspectRatio))
  }, [keyframes, camera.aspectRatio, totalFrames])

  const togglePlayback = useCallback(() => {
    setPlaying(wasPlaying => {
      if (wasPlaying) {
        const pausedFrame = currentFrameRef.current
        if (keyframes.length) setCamera(cameraAtFrame(keyframes, pausedFrame, camera.aspectRatio))
      }
      if (!wasPlaying && currentFrameRef.current >= totalFrames) {
        setCurrentFrame(0)
        currentFrameRef.current = 0
        if (keyframes.length) setCamera(cameraAtFrame(keyframes, 0, camera.aspectRatio))
      }
      if (!wasPlaying) setObjectDrafts({})
      return !wasPlaying
    })
  }, [keyframes, camera.aspectRatio, totalFrames])

  useEffect(() => {
    if (!playing) { playStartRef.current = null; return }
    let frameId
    const animate = timestamp => {
      if (playStartRef.current === null) playStartRef.current = timestamp - currentFrameRef.current / fps * 1000
      let frame = Math.floor((timestamp - playStartRef.current) / 1000 * fps)
      if (frame >= totalFrames) {
        if (settings.loopPlayback) {
          frame %= totalFrames
          playStartRef.current = timestamp - frame / fps * 1000
        } else {
          setCurrentFrame(totalFrames)
          currentFrameRef.current = totalFrames
          if (keyframes.length) setCamera(cameraAtFrame(keyframes, totalFrames, camera.aspectRatio))
          setPlaying(false)
          return
        }
      }
      setCurrentFrame(frame)
      currentFrameRef.current = frame
      frameId = requestAnimationFrame(animate)
    }
    frameId = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(frameId)
  }, [playing, keyframes, camera.aspectRatio, fps, totalFrames, settings.loopPlayback])

  useEffect(() => {
    const onKeyDown = event => {
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return
      if (event.key.toLowerCase() === 'w') setTransformMode('translate')
      if (event.key.toLowerCase() === 'e') setTransformMode('rotate')
      if (event.key.toLowerCase() === 'r') setTransformMode('scale')
      if (event.key.toLowerCase() === 'f') focusSelected()
      if (event.code === 'Space') { event.preventDefault(); togglePlayback() }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId !== CAMERA_ID) deleteSelected()
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') { event.preventDefault(); duplicateSelected() }
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'z') { event.preventDefault(); undo() }
      if ((event.ctrlKey || event.metaKey) && (event.key.toLowerCase() === 'y' || (event.shiftKey && event.key.toLowerCase() === 'z'))) { event.preventDefault(); redo() }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedId, objects, togglePlayback, undo, redo, focusSelected])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(''), 1800)
    return () => clearTimeout(timer)
  }, [toast])

  const applySettings = nextSettings => {
    const next = normalizeProjectSettings(nextSettings)
    const nextTotalFrames = next.fps * next.durationSeconds
    if (nextTotalFrames < maxKeyframeFrame) {
      setToast(`时间轴至少要保留到第 ${maxKeyframeFrame} 帧，请延长镜头时长`)
      return
    }
    setPlaying(false)
    setSettings(next)
    setShots(list => list.map(shot => shot.id === activeShotId ? { ...shot, fps: next.fps, durationSeconds: next.durationSeconds, loopPlayback: next.loopPlayback } : shot))
    setCurrentFrame(frame => {
      const nextFrame = clamp(frame, 0, nextTotalFrames)
      currentFrameRef.current = nextFrame
      return nextFrame
    })
    setSettingsOpen(false)
    setToast(`镜头设置已更新 · ${next.fps} FPS · ${next.durationSeconds} 秒`)
  }

  const thumbnailFromMonitor = () => {
    const source = monitorCanvasRef.current
    if (!source?.width || !source?.height) return ''
    try {
      const canvas = document.createElement('canvas')
      canvas.width = 240
      canvas.height = 135
      const context = canvas.getContext('2d')
      context.fillStyle = '#11110f'
      context.fillRect(0, 0, canvas.width, canvas.height)
      const scale = Math.min(canvas.width / source.width, canvas.height / source.height)
      const width = source.width * scale
      const height = source.height * scale
      context.drawImage(source, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height)
      return canvas.toDataURL('image/jpeg', 0.74)
    } catch {
      return ''
    }
  }

  const liveShotRecord = (shot, thumbnail = shot?.thumbnail || '') => ({
    ...shot,
    id: shot?.id || activeShotId,
    name: shot?.name || '镜头',
    thumbnail,
    fps: settings.fps,
    durationSeconds: settings.durationSeconds,
    loopPlayback: settings.loopPlayback,
    objects,
    camera,
    reference,
    keyframes,
    objectKeyframes: characterKeyframes,
  })

  const applyShotState = shot => {
    setPlaying(false)
    setObjectDrafts({})
    setSelectedKeyframe(null)
    setKeyframeClipboard(null)
    setSettings(current => ({ ...current, fps: shot.fps, durationSeconds: shot.durationSeconds, loopPlayback: shot.loopPlayback }))
    setObjects(cloneProjectValue(shot.objects))
    setCamera(cloneProjectValue(shot.camera))
    setReference(normalizeReference(shot.reference))
    setKeyframes(cloneProjectValue(shot.keyframes || []))
    setCharacterKeyframes(cloneProjectValue(shot.objectKeyframes || {}))
    setCurrentFrame(0)
    currentFrameRef.current = 0
    setActiveShotId(shot.id)
    setSelectedId(shot.objects?.[0]?.id || CAMERA_ID)
  }

  const switchShot = shotId => {
    if (shotId === activeShotId) return
    const target = shots.find(shot => shot.id === shotId)
    if (!target) return
    const thumbnail = thumbnailFromMonitor()
    setShots(list => list.map(shot => shot.id === activeShotId ? liveShotRecord(shot, thumbnail || shot.thumbnail) : shot))
    applyShotState(target)
    setToast(`已切换到“${target.name}”`)
  }

  const addShot = () => {
    if (shots.length >= 30) { setToast('每个工程最多 30 个镜头'); return }
    const thumbnail = thumbnailFromMonitor()
    const id = `shot-${uid()}`
    const nextShot = {
      id,
      name: uniqueShotName(shots, defaultShotName(shots.length)),
      thumbnail,
      fps: settings.fps,
      durationSeconds: settings.durationSeconds,
      loopPlayback: settings.loopPlayback,
      objects: cloneProjectValue(objects),
      camera: cloneProjectValue(camera),
      reference: cloneProjectValue(DEFAULT_REFERENCE),
      keyframes: [],
      objectKeyframes: {},
    }
    setShots(list => [...list.map(shot => shot.id === activeShotId ? liveShotRecord(shot, thumbnail || shot.thumbnail) : shot), nextShot])
    applyShotState(nextShot)
    setToast(`已新建“${nextShot.name}” · 场景已复制，关键帧和参考图为空`)
  }

  const duplicateShot = shotId => {
    if (shots.length >= 30) { setToast('每个工程最多 30 个镜头'); return }
    const thumbnail = thumbnailFromMonitor()
    const storedSource = shots.find(shot => shot.id === shotId)
    if (!storedSource) return
    const source = shotId === activeShotId ? liveShotRecord(storedSource, thumbnail || storedSource.thumbnail) : storedSource
    const duplicate = cloneProjectValue({ ...source, id: `shot-${uid()}`, name: uniqueShotName(shots, `${source.name} 副本`) })
    setShots(list => {
      const persisted = list.map(shot => shot.id === activeShotId ? liveShotRecord(shot, thumbnail || shot.thumbnail) : shot)
      const sourceIndex = persisted.findIndex(shot => shot.id === shotId)
      return [...persisted.slice(0, sourceIndex + 1), duplicate, ...persisted.slice(sourceIndex + 1)]
    })
    applyShotState(duplicate)
    setToast(`已复制“${source.name}”`)
  }

  const deleteShot = shotId => {
    if (shots.length <= 1) return
    const sourceIndex = shots.findIndex(shot => shot.id === shotId)
    const source = shots[sourceIndex]
    if (!source || !window.confirm(`删除镜头“${source.name}”？`)) return
    const thumbnail = thumbnailFromMonitor()
    const persisted = shots.map(shot => shot.id === activeShotId ? liveShotRecord(shot, thumbnail || shot.thumbnail) : shot)
    const remaining = persisted.filter(shot => shot.id !== shotId)
    setShots(remaining)
    if (shotId === activeShotId) applyShotState(remaining[Math.min(sourceIndex, remaining.length - 1)])
    setToast(`已删除“${source.name}”`)
  }

  const renameShot = (shotId, name, commit = false) => setShots(list => {
    const index = list.findIndex(shot => shot.id === shotId)
    if (index < 0) return list
    const draft = String(name || '').slice(0, 30)
    const nextName = commit ? (draft.trim() || defaultShotName(index)) : draft
    return list.map(shot => shot.id === shotId ? { ...shot, name: nextName } : shot)
  })

  const captureShotThumbnail = shotId => {
    if (shotId !== activeShotId) { setToast('请先切换到该镜头再更新缩略图'); return }
    const thumbnail = thumbnailFromMonitor()
    if (!thumbnail) { setToast('摄像机画面尚未准备好，请稍后重试'); return }
    setShots(list => list.map(shot => shot.id === shotId ? { ...shot, thumbnail } : shot))
    setToast('镜头缩略图已更新')
  }

  const addPerson = bodyType => {
    const id = uid()
    const person = { id, name: `人物 · ${objects.filter(item => item.type === 'person').length + 1}`, type: 'person', bodyType, pose: 'idle', poseTime: presetPhase('idle'), joints: presetJoints(), rigRoot: [0, 0, 0], footLock: false, continuousMotion: false, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], color: '#e8e3d8' }
    setObjects(list => [...list, person])
    setSelectedId(id)
  }
  const addPrimitive = type => {
    const id = uid()
    const labels = { box: '方块', sphere: '球体', cylinder: '圆柱', plane: '平面', arch: '拱门', stairs: '楼梯', table: '桌子', chair: '椅子', sofa: '沙发', door: '门', window: '窗', tree: '树木', vehicle: '车辆', roof: '屋顶' }
    const defaultScales = { arch: [1.8, 2.2, 0.45], stairs: [2.2, 1.4, 2.8], door: [1.2, 2.2, 0.25], window: [1.5, 1.3, 0.22], table: [1.7, 1, 1.1], chair: [0.8, 1, 0.8], sofa: [2.2, 1.1, 1], tree: [1.8, 2.6, 1.8], vehicle: [2.8, 1.2, 1.6], roof: [2.8, 1.2, 2.2] }
    const positionY = type === 'plane' ? 0.02 : (type === 'tree' ? 1.3 : 0.5)
    setObjects(list => [...list, { id, name: `${labels[type] || type} · ${list.filter(item => item.type === type).length + 1}`, type, position: [0, positionY, 0], rotation: [0, 0, 0], scale: type === 'plane' ? [2, 1, 2] : (defaultScales[type] || [1, 1, 1]), color: type === 'tree' ? '#9ca68d' : '#c7c2b7' }])
    setSelectedId(id)
  }
  const importModel = event => {
    const file = event.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const id = uid()
      setObjects(list => [...list, { id, name: file.name.replace(/\.(glb|gltf)$/i, ''), type: 'model', url: reader.result, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], color: '#ddd8cc' }])
      setSelectedId(id)
      setToast('模型已加入场景')
    }
    reader.readAsDataURL(file)
    event.target.value = ''
  }
  const updateObjectById = (id, patch) => {
    setObjectDrafts(drafts => {
      const source = drafts[id] || objectAtFrame(objects.find(object => object.id === id), characterKeyframes[id], currentFrame, fps)
      return source ? { ...drafts, [id]: { ...source, ...patch } } : drafts
    })
    setObjects(list => list.map(object => object.id === id ? { ...object, ...patch } : object))
  }
  const updateSelected = patch => updateObjectById(selectedId, patch)
  const captureEditorView = useCallback(view => {
    if (view?.position?.length === 3 && view?.rotation?.length === 3 && view?.target?.length === 3) editorViewRef.current = view
  }, [])
  const openCameraView = () => {
    setEditorView(cloneProjectValue(editorViewRef.current))
    setCameraView(true)
  }
  const openEditorView = () => setCameraView(false)
  const saveCustomPose = person => {
    if (!person || person.type !== 'person') return
    const suggestedName = `自定义姿势 ${customPoses.length + 1}`
    const name = window.prompt('为当前姿势命名', suggestedName)?.trim()
    if (!name) return
    const rig = poseForObject(person)
    setCustomPoses(list => [...list, {
      id: uid(),
      name,
      pose: normalizePoseId(person.pose),
      poseTime: Number.isFinite(person.poseTime) ? person.poseTime : presetPhase(person.pose),
      rigRoot: [...rig.root],
      joints: cloneJointPose(rig.joints),
    }])
    setToast(`姿势“${name}”已保存到本机`)
  }
  const applyCustomPose = customPose => {
    if (!customPose || !activeObject || activeObject.type !== 'person') return
    updateSelected({
      pose: normalizePoseId(customPose.pose),
      poseTime: Number.isFinite(customPose.poseTime) ? customPose.poseTime : presetPhase(customPose.pose),
      rigRoot: [...(customPose.rigRoot || presetRoot())],
      joints: cloneJointPose(customPose.joints),
    })
    setToast(`已应用姿势“${customPose.name}”`)
  }
  const deleteCustomPose = poseId => {
    const pose = customPoses.find(item => item.id === poseId)
    if (!pose || !window.confirm(`删除姿势“${pose.name}”？`)) return
    setCustomPoses(list => list.filter(item => item.id !== poseId))
    setToast(`已删除姿势“${pose.name}”`)
  }
  const deleteSelected = () => {
    if (selectedId === CAMERA_ID) return
    const source = objects.find(object => object.id === selectedId)
    if (source?.locked) { setToast('物体已锁定，请先解除锁定'); return }
    setObjects(list => list.filter(object => object.id !== selectedId))
    setCharacterKeyframes(tracks => {
      const next = { ...tracks }
      delete next[selectedId]
      return next
    })
    setObjectDrafts(drafts => {
      const next = { ...drafts }
      delete next[selectedId]
      return next
    })
    setSelectedId(CAMERA_ID)
  }
  const duplicateSelected = () => {
    const source = objects.find(object => object.id === selectedId)
    if (!source) return
    const id = uid()
    const duplicate = { ...source, id, name: `${source.name} 副本`, position: [source.position[0] + 0.6, source.position[1], source.position[2] + 0.6] }
    setObjects(list => [...list, duplicate])
    setCharacterKeyframes(tracks => {
      const sourceTrack = tracks[source.id]
      if (!sourceTrack?.length) return tracks
      return {
        ...tracks,
        [id]: sourceTrack.map(key => ({ ...key, position: [key.position[0] + 0.6, key.position[1], key.position[2] + 0.6] })),
      }
    })
    setSelectedId(id)
  }
  const addKeyframe = () => {
    const existing = keyframes.find(key => key.frame === currentFrame)
    const next = { frame: currentFrame, interpolation: normalizeInterpolation(existing?.interpolation), position: [...camera.position], rotation: [...camera.rotation], focalLength: camera.focalLength }
    setKeyframes(list => [...list.filter(key => key.frame !== currentFrame), next].sort((a, b) => a.frame - b.frame))
    setSelectedKeyframe({ kind: 'camera', frame: currentFrame, trackId: null })
    setToast(`已记录第 ${currentFrame} 帧`)
  }
  const deleteKeyframe = frame => {
    setKeyframes(list => list.filter(key => key.frame !== frame))
    if (selectedKeyframe?.kind === 'camera' && selectedKeyframe.frame === frame) setSelectedKeyframe(null)
  }
  const addObjectKeyframe = () => {
    if (!activeObject) return
    const source = objectDrafts[activeObject.id] || activeObject
    const existing = characterKeyframes[activeObject.id]?.find(key => key.frame === currentFrame)
    const next = { ...objectKeyframeFromObject(source, currentFrame), interpolation: normalizeInterpolation(existing?.interpolation) }
    setCharacterKeyframes(tracks => ({
      ...tracks,
      [activeObject.id]: [...(tracks[activeObject.id] || []).filter(key => key.frame !== currentFrame), next].sort((a, b) => a.frame - b.frame),
    }))
    setSelectedKeyframe({ kind: 'object', frame: currentFrame, trackId: activeObject.id })
    setObjectDrafts(drafts => {
      const nextDrafts = { ...drafts }
      delete nextDrafts[activeObject.id]
      return nextDrafts
    })
    setToast(activeObject.type === 'person' ? `已记录“${activeObject.name}”第 ${currentFrame} 帧角色状态` : `已记录“${activeObject.name}”第 ${currentFrame} 帧`)
  }
  const deleteObjectKeyframe = frame => {
    if (!activeObject) return
    setCharacterKeyframes(tracks => {
      const current = tracks[activeObject.id] || []
      const remaining = current.filter(key => key.frame !== frame)
      if (remaining.length) return { ...tracks, [activeObject.id]: remaining }
      const next = { ...tracks }
      delete next[activeObject.id]
      return next
    })
    if (selectedKeyframe?.kind === 'object' && selectedKeyframe.trackId === activeObject.id && selectedKeyframe.frame === frame) setSelectedKeyframe(null)
  }
  const moveKeyframe = ({ kind, trackId, fromFrame, toFrame }) => {
    const move = list => {
      const source = list.find(key => key.frame === fromFrame)
      if (!source) return list
      return [...list.filter(key => key.frame !== fromFrame && key.frame !== toFrame), { ...source, frame: toFrame }].sort((a, b) => a.frame - b.frame)
    }
    if (kind === 'camera') setKeyframes(move)
    else setCharacterKeyframes(tracks => ({ ...tracks, [trackId]: move(tracks[trackId] || []) }))
    setSelectedKeyframe({ kind, trackId, frame: toFrame })
    seekToFrame(toFrame)
    setToast(`关键帧已移动到第 ${toFrame} 帧`)
  }
  const changeSelectedInterpolation = interpolation => {
    if (!selectedKeyframeInfo) return
    const update = list => list.map(key => key.frame === selectedKeyframeInfo.frame ? { ...key, interpolation: normalizeInterpolation(interpolation) } : key)
    if (selectedKeyframeInfo.kind === 'camera') setKeyframes(update)
    else setCharacterKeyframes(tracks => ({ ...tracks, [selectedKeyframeInfo.trackId]: update(tracks[selectedKeyframeInfo.trackId] || []) }))
  }
  const copySelectedKeyframe = () => {
    if (!selectedKeyframeInfo) return
    const track = selectedKeyframeInfo.kind === 'camera' ? keyframes : characterKeyframes[selectedKeyframeInfo.trackId]
    const key = track?.find(item => item.frame === selectedKeyframeInfo.frame)
    if (!key) return
    setKeyframeClipboard({ kind: selectedKeyframeInfo.kind, key: JSON.parse(JSON.stringify(key)) })
    setToast('关键帧已复制')
  }
  const pasteKeyframe = () => {
    if (!keyframeClipboard) return
    const next = { ...JSON.parse(JSON.stringify(keyframeClipboard.key)), frame: currentFrame }
    if (keyframeClipboard.kind === 'camera') {
      setKeyframes(list => [...list.filter(key => key.frame !== currentFrame), next].sort((a, b) => a.frame - b.frame))
      setSelectedKeyframe({ kind: 'camera', frame: currentFrame, trackId: null })
    } else {
      if (!activeObject) { setToast('请先选择要粘贴关键帧的物体'); return }
      setCharacterKeyframes(tracks => ({ ...tracks, [activeObject.id]: [...(tracks[activeObject.id] || []).filter(key => key.frame !== currentFrame), next].sort((a, b) => a.frame - b.frame) }))
      setSelectedKeyframe({ kind: 'object', frame: currentFrame, trackId: activeObject.id })
    }
    setToast(`关键帧已粘贴到第 ${currentFrame} 帧`)
  }
  const deleteSelectedKeyframe = () => {
    if (!selectedKeyframeInfo) return
    if (selectedKeyframeInfo.kind === 'camera') deleteKeyframe(selectedKeyframeInfo.frame)
    else if (activeObject?.id === selectedKeyframeInfo.trackId) deleteObjectKeyframe(selectedKeyframeInfo.frame)
  }
  const saveProject = ({ download = false } = {}) => {
    const data = projectData({ settings, objects, camera, reference, keyframes, objectKeyframes: characterKeyframes, shots, activeShotId })
    const serialized = JSON.stringify(data)
    let cached = true
    try { localStorage.setItem(PROJECT_STORAGE_KEY, serialized) } catch { cached = false }
    if (download) {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      const safeName = settings.name.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'monoform-project'
      link.download = `${safeName}.monoform.json`
      link.click()
      URL.revokeObjectURL(link.href)
    }
    if (download) setToast(cached ? '工程 JSON 已导出' : '工程已导出，但浏览器自动保存空间不足')
    else setToast(cached ? '工程已保存到浏览器' : '浏览器保存空间不足，请使用“导出工程”备份')
  }
  const handleCaptureImage = async () => {
    if (exportLockRef.current || exporting || capturingImage) return
    exportLockRef.current = true
    setPlaying(false)
    imageCaptureCanvasRef.current = null
    try {
      const { width, height } = exportDimensions
      const backgroundCanvas = await referenceCanvasForExport(reference, width, height)
      setExportReferenceBackground(backgroundCanvas)
      setCapturingImage(true)
      let canvas = null
      for (let attempt = 0; attempt < 90; attempt += 1) {
        await nextPaint()
        canvas = imageCaptureCanvasRef.current
        if (canvas?.width === width && canvas?.height === height) break
      }
      if (!canvas || canvas.width !== width || canvas.height !== height) throw new Error('截图画面初始化失败')
      await nextPaint()
      const blob = await new Promise((resolve, reject) => canvas.toBlob(result => result ? resolve(result) : reject(new Error('PNG 生成失败')), 'image/png'))
      const link = document.createElement('a')
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
      link.href = URL.createObjectURL(blob)
      link.download = `monoform-shot-${stamp}-frame-${String(currentFrameRef.current).padStart(3, '0')}.png`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(link.href)
      setToast(`摄像机截图已导出 · ${width} × ${height}`)
    } catch (error) {
      setToast(error?.message || '摄像机截图失败')
    } finally {
      setCapturingImage(false)
      setExportReferenceBackground(null)
      imageCaptureCanvasRef.current = null
      exportLockRef.current = false
    }
  }
  const handleExportMp4 = async () => {
    if (exportLockRef.current || exporting || capturingImage) return
    exportLockRef.current = true
    const originalFrame = currentFrameRef.current
    const originalCamera = keyframes.length ? cameraAtFrame(keyframes, originalFrame, camera.aspectRatio) : camera
    let output

    setPlaying(false)
    setObjectDrafts({})
    setCamera(originalCamera)
    setExportProgress(0)
    exportCanvasRef.current = null

    try {
      if (typeof VideoEncoder === 'undefined') throw new Error('当前浏览器不支持视频编码，请使用最新版 Chrome 或 Edge')
      const {
        BufferTarget, CanvasSource, Mp4OutputFormat, Output,
        QUALITY_HIGH, getFirstEncodableVideoCodec,
      } = await import('mediabunny')
      const { width, height } = exportDimensions
      const backgroundCanvas = await referenceCanvasForExport(reference, width, height)
      setExportReferenceBackground(backgroundCanvas)
      setExporting(true)
      const codec = await getFirstEncodableVideoCodec(['avc', 'av1', 'vp9'], { width, height, quality: QUALITY_HIGH })
      if (!codec) throw new Error('当前设备没有可用的 MP4 视频编码器')

      let canvas = null
      for (let attempt = 0; attempt < 120; attempt += 1) {
        await nextPaint()
        canvas = exportCanvasRef.current
        if (canvas?.width === width && canvas?.height === height) break
      }
      if (!canvas || canvas.width !== width || canvas.height !== height) throw new Error('导出画面初始化失败')

      output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() })
      const videoSource = new CanvasSource(canvas, {
        codec,
        quality: QUALITY_HIGH,
        keyFrameInterval: 2,
        latencyMode: 'quality',
      })
      output.addVideoTrack(videoSource, { frameRate: fps })
      await output.start()

      const exportFrameCount = totalFrames
      for (let sample = 0; sample < exportFrameCount; sample += 1) {
        const timelineFrame = exportFrameCount > 1 ? sample / (exportFrameCount - 1) * totalFrames : 0
        setCurrentFrame(timelineFrame)
        currentFrameRef.current = timelineFrame
        await nextPaint()
        await videoSource.add(sample / fps, 1 / fps, { keyFrame: sample % (fps * 2) === 0 })
        setExportProgress(Math.round((sample + 1) / exportFrameCount * 100))
      }

      await output.finalize()
      const buffer = output.target.buffer
      if (!buffer) throw new Error('MP4 文件生成失败')
      const blob = new Blob([buffer], { type: 'video/mp4' })
      const link = document.createElement('a')
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
      link.href = URL.createObjectURL(blob)
      const safeName = settings.name.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'monoform-animation'
      link.download = `${safeName}-${stamp}.mp4`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(link.href)
      setToast(`MP4 已导出 · ${width} × ${height} · ${fps} FPS`)
    } catch (error) {
      if (output && output.state !== 'finalized') await output.cancel().catch(() => {})
      setToast(error?.message || 'MP4 导出失败')
    } finally {
      setCurrentFrame(originalFrame)
      currentFrameRef.current = originalFrame
      setCamera(originalCamera)
      setExporting(false)
      setExportProgress(0)
      setExportReferenceBackground(null)
      exportCanvasRef.current = null
      exportLockRef.current = false
    }
  }
  const loadProject = event => {
    const file = event.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const loaded = normalizeProjectData(JSON.parse(reader.result))
        if (!loaded) throw new Error('invalid project')
        setSettings(loaded.settings)
        setShots(loaded.shots)
        setActiveShotId(loaded.activeShotId)
        setObjects(loaded.objects)
        setCamera(loaded.camera)
        setReference(loaded.reference)
        setKeyframes(loaded.keyframes)
        setCharacterKeyframes(loaded.objectKeyframes)
        setObjectDrafts({})
        setSelectedKeyframe(null)
        setCurrentFrame(0)
        currentFrameRef.current = 0
        setPlaying(false)
        setSettingsOpen(false)
        setSelectedId(CAMERA_ID)
        setToast(`工程已打开 · ${loaded.shots.length} 个镜头`)
      } catch { setToast('工程文件无法读取') }
    }
    reader.readAsText(file)
    event.target.value = ''
  }
  const resetProject = () => {
    const resetObjects = cloneProjectValue(initialObjects)
    const resetCamera = cloneProjectValue(initialCamera)
    setSettings({ ...DEFAULT_PROJECT_SETTINGS })
    setShots([{ id: 'shot-01', name: '镜头 01', thumbnail: '', fps: 24, durationSeconds: 5, loopPlayback: false, objects: resetObjects, camera: resetCamera, reference: cloneProjectValue(DEFAULT_REFERENCE), keyframes: [], objectKeyframes: {} }])
    setActiveShotId('shot-01')
    setObjects(resetObjects)
    setCamera(resetCamera)
    setReference(cloneProjectValue(DEFAULT_REFERENCE))
    setKeyframes(initialKeyframes)
    setCharacterKeyframes(initialCharacterKeyframes)
    setObjectDrafts({})
    setSelectedKeyframe(null)
    setCurrentFrame(0)
    currentFrameRef.current = 0
    setPlaying(false)
    setSettingsOpen(false)
    setSelectedId('actor-lead')
    setToast('已新建空关键帧工程')
  }

  return (
    <main className="app-shell" aria-busy={exporting || capturingImage}>
      <header className="topbar">
        <div className="brand-mark">
          <span className="brand-glyph"><img src={BRAND_MARK_URL} alt="" /></span>
          <div><strong>MONOFORM</strong><small>PREVIS STUDIO · 白模预演</small></div>
        </div>
        <nav className="top-actions">
          <button onClick={resetProject}><Plus size={14} /> 新建</button>
          <button onClick={() => loadRef.current?.click()}><FolderOpen size={14} /> 打开</button>
          <button onClick={() => saveProject()}><Save size={14} /> 保存</button>
          <input ref={loadRef} className="visually-hidden" type="file" accept=".json" onChange={loadProject} />
          <span className="top-divider" />
          <ToolButton icon={Undo2} label="撤销" shortcut="Ctrl+Z" onClick={undo} disabled={!historyRef.current.past.length} />
          <ToolButton icon={Redo2} label="重做" shortcut="Ctrl+Y" onClick={redo} disabled={!historyRef.current.future.length} />
        </nav>
        <div className="project-title"><i className={`status-dot ${saveStatus === '保存中…' ? '' : 'live'}`} /><button type="button" onClick={() => setSettingsOpen(true)} title="打开镜头设置"><span>{settings.name}</span><Settings2 size={12} /></button><small>{activeShot?.name} · {saveStatus}</small></div>
        <div className="export-actions">
          <button className="project-export-button" onClick={() => saveProject({ download: true })} disabled={exporting || capturingImage}><Download size={14} /> 导出工程</button>
          <button className="project-export-button capture-image-button" onClick={handleCaptureImage} disabled={exporting || capturingImage}><FileImage size={14} /> {capturingImage ? '截图中…' : '截图 PNG'}</button>
          <button className="export-button" onClick={handleExportMp4} disabled={exporting || capturingImage}><FileVideo2 size={14} /> {exporting ? `${exportProgress}%` : '导出 MP4'}</button>
        </div>
      </header>

      <div className="workspace">
        <LeftSidebar objects={objects} selectedId={selectedId} onSelect={setSelectedId} onAddPerson={addPerson} onAddPrimitive={addPrimitive} onImport={importModel} onToggleVisible={id => updateObjectById(id, { visible: objects.find(item => item.id === id)?.visible === false })} onToggleLock={id => updateObjectById(id, { locked: !objects.find(item => item.id === id)?.locked })} shots={displayedShots} activeShotId={activeShotId} onSelectShot={switchShot} onAddShot={addShot} onDuplicateShot={duplicateShot} onDeleteShot={deleteShot} onRenameShot={renameShot} onCaptureShot={captureShotThumbnail} />
        <section className="viewport-shell">
          <div className="viewport-toolbar floating-panel">
            <ToolButton icon={MousePointer2} label="选择" active={!['translate', 'rotate', 'scale'].includes(transformMode)} onClick={() => setTransformMode('select')} shortcut="Q" />
            <span />
            <ToolButton icon={Move3D} label="移动" active={transformMode === 'translate'} onClick={() => setTransformMode('translate')} shortcut="W" />
            <ToolButton icon={RotateCw} label="旋转" active={transformMode === 'rotate'} onClick={() => setTransformMode('rotate')} shortcut="E" />
            <ToolButton icon={BoxSelect} label="缩放" active={transformMode === 'scale'} onClick={() => setTransformMode('scale')} shortcut="R" />
          </div>
          <div className="viewport-mode-help">
            {transformMode === 'select' && 'Q 选择 / 人物摆姿 · 重叠处优先当前对象 · Alt 选择前层'}
            {transformMode === 'translate' && 'W 整体移动 · 当前选择已锁定 · 拖动红 / 绿 / 蓝坐标轴'}
            {transformMode === 'rotate' && (selectedId === CAMERA_ID ? 'E 摄像机旋转 · 当前选择已锁定 · 拖动红 / 绿 / 蓝圆环' : 'E 整体旋转 · 当前选择已锁定 · 左右水平 / 上下纵向 / Shift 翻滚')}
            {transformMode === 'scale' && 'R 整体缩放 · 当前选择已锁定 · 拖动坐标轴或中心块'}
          </div>
          <div className="viewport-view-options floating-panel">
            <button className={showGrid ? 'is-active' : ''} onClick={() => setShowGrid(value => !value)}><Grid3X3 size={14} /> 网格</button>
            <button className={!cameraView ? 'is-active' : ''} onClick={openEditorView} title="使用固定的编辑观察相机自由布置场景"><RotateCw size={14} /> 编辑视角</button>
            <button className={cameraView ? 'is-active' : ''} onClick={openCameraView} title="切换到场景中主摄像机的实际画面"><Camera size={14} /> 摄像机视角</button>
            <button><span className="solid-sphere" /> 实体</button>
          </div>
          <div className="viewport-label"><strong>{cameraView ? '摄像机视角' : '编辑视角'}</strong><span>{cameraView ? `${displayCamera.aspectRatio || '16:9'} · 正在查看场景中的主摄像机` : '固定观察相机 · 可查看并调整场景中的主摄像机'}</span></div>
          <ReferenceOverlay reference={reference} onChange={setReference} onToast={setToast} cameraMode={cameraView} cameraAspect={previewAspect}>
            <div className="viewport-canvas-layer">
              <MainViewport key={cameraView ? 'shot-view' : 'scene-view'} cameraView={cameraView} editorCameraData={editorView} onEditorCameraChange={captureEditorView} objects={animatedObjects} animationTime={currentFrame / fps} selectedId={selectedId} activeJoint={selectedJoint} onSelect={setSelectedId} onJointSelect={(objectId, jointId) => { setSelectedId(objectId); setSelectedJoint(jointId) }} transformMode={transformMode} onUpdateObject={updateObjectById} cameraData={displayCamera} onUpdateCamera={patch => setCamera(current => ({ ...current, ...patch }))} showGrid={cameraView ? false : showGrid} focusRequest={viewFocusRequest} referenceVisible={Boolean(reference.image && (cameraView ? reference.includeInExport : reference.visible))} />
            </div>
          </ReferenceOverlay>
          <div className="navigation-hint"><span><MousePointer2 size={12} /> 点击物体选择</span>{cameraView ? <><span>主摄像机画面</span><span>与 PNG / MP4 导出一致</span></> : <><span>空白处左键旋转</span><span>右键平移</span><span>滚轮缩放</span></>}</div>
          <div className="camera-monitor">
            <div className="monitor-head"><div><Video size={13} /><strong>主摄像机 01</strong><span>CAMERA VIEW</span></div><div className="monitor-head-actions"><button title="选择场景中的主摄像机" onClick={() => setSelectedId(CAMERA_ID)}><Camera size={12} /></button><button title="切换到摄像机视角" onClick={openCameraView}><ZoomIn size={13} /></button></div></div>
            <div className="monitor-frame">
              <div className={`monitor-canvas ${previewAspectClass}`} style={{ '--preview-aspect': previewAspect }}>
                <CameraPreview objects={animatedObjects} animationTime={currentFrame / fps} cameraData={displayCamera} backgroundCanvas={monitorReferenceBackground} onCanvasReady={canvas => { monitorCanvasRef.current = canvas }} />
                <span className="safe-frame" />
                <span className="owner-watermark" aria-label="MONOFORM 品牌标识"><i><img src={BRAND_MARK_URL} alt="" /></i><b>MONOFORM</b></span>
                <span className="monitor-timecode">{timecodeAtFrame(currentFrame, fps)}</span>
                <span className="monitor-focal">{Math.round(displayCamera.focalLength)} mm · {displayCamera.aspectRatio || '16:9'}</span>
              </div>
            </div>
          </div>
        </section>
        <Inspector selected={inspectorSelected} camera={camera} selectedJoint={selectedJoint} customPoses={customPoses} onSelectJoint={setSelectedJoint} onUpdateObject={updateSelected} onUpdateCamera={patch => setCamera(current => ({ ...current, ...patch }))} onDelete={deleteSelected} onDuplicate={duplicateSelected} onFocus={focusSelected} onToggleLock={() => activeObject && updateSelected({ locked: !activeObject.locked })} onSaveCustomPose={saveCustomPose} onApplyCustomPose={applyCustomPose} onDeleteCustomPose={deleteCustomPose} />
        <Timeline
          currentFrame={currentFrame}
          fps={fps}
          totalFrames={totalFrames}
          onSeek={seekToFrame}
          playing={playing}
          onTogglePlay={togglePlayback}
          keyframes={keyframes}
          onAddKeyframe={addKeyframe}
          onDeleteKeyframe={deleteKeyframe}
          objectTrack={activeObject ? { id: activeObject.id, name: activeObject.name, type: activeObject.type, keyframes: characterKeyframes[activeObject.id] || [] } : null}
          onAddObjectKeyframe={addObjectKeyframe}
          onDeleteObjectKeyframe={deleteObjectKeyframe}
          selectedKeyframe={selectedKeyframeInfo}
          onSelectKeyframe={setSelectedKeyframe}
          onMoveKeyframe={moveKeyframe}
          onCopyKeyframe={copySelectedKeyframe}
          onPasteKeyframe={pasteKeyframe}
          onDeleteSelectedKeyframe={deleteSelectedKeyframe}
          onChangeInterpolation={changeSelectedInterpolation}
          hasClipboard={Boolean(keyframeClipboard)}
        />
      </div>
      {capturingImage && (
        <div className="export-render-surface" style={{ width: exportDimensions.width, height: exportDimensions.height }} aria-hidden="true">
          <CameraPreview objects={animatedObjects} animationTime={currentFrame / fps} cameraData={displayCamera} exportMode backgroundCanvas={exportReferenceBackground} onCanvasReady={canvas => { imageCaptureCanvasRef.current = canvas }} />
        </div>
      )}
      {exporting && (
        <>
          <div className="export-render-surface" style={{ width: exportDimensions.width, height: exportDimensions.height }} aria-hidden="true">
            <CameraPreview objects={animatedObjects} animationTime={currentFrame / fps} cameraData={displayCamera} exportMode backgroundCanvas={exportReferenceBackground} onCanvasReady={canvas => { exportCanvasRef.current = canvas }} />
          </div>
          <div className="export-progress-overlay" role="status" aria-live="polite">
            <div className="export-progress-card">
              <FileVideo2 size={20} />
              <div className="export-progress-copy"><strong>正在编码 MP4</strong><span>{exportDimensions.width} × {exportDimensions.height} · {fps} FPS · 第 {Math.round(exportProgress / 100 * totalFrames)} / {totalFrames} 帧</span></div>
              <output>{exportProgress}%</output>
              <div className="export-progress-track"><i style={{ width: `${exportProgress}%` }} /></div>
            </div>
          </div>
        </>
      )}
      {settingsOpen && <ProjectSettingsDialog settings={settings} onApply={applySettings} onClose={() => setSettingsOpen(false)} />}
      {toast && <div className="toast"><span />{toast}</div>}
    </main>
  )
}
