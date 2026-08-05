import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Box, BoxSelect, Camera, ChevronDown, CircleDot, Copy, Download,
  FileImage, FileVideo2, Focus, FolderOpen, Grid3X3, Import, Lock, MousePointer2, Move3D, Pause, Play, Plus,
  Redo2, RotateCw, Save, Settings2, SkipBack, SkipForward, Sparkles,
  ScanLine, Trash2, Undo2, UserRound, Video, ZoomIn,
  Unlock,
} from 'lucide-react'
import { MainViewport, CameraPreview } from './Viewport.jsx'
import { JOINT_DEFINITIONS, JOINT_GROUPS, RIG_PRESET_GROUPS, RIG_PRESET_OPTIONS, cloneJointPose, interpolateJointPose, normalizePoseId, poseCanLoop, poseForObject, presetJoints, presetPhase, presetRoot } from './rig.js'

const CAMERA_ID = '__shot_camera__'
const PROJECT_STORAGE_KEY = 'monoform-project'
const LEGACY_PROJECT_STORAGE_KEY = 'stageframe-project'
const CUSTOM_POSE_STORAGE_KEY = 'monoform-custom-poses'
const PROJECT_VERSION = 10
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

const initialCamera = {
  position: [7.4, 4.6, 8.2],
  target: [0.2, 1.2, 0],
  focalLength: 42,
  aspectRatio: '16:9',
}

const initialKeyframes = []
const initialCharacterKeyframes = {}

const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
const radToDeg = value => Math.round((value * 180 / Math.PI) * 10) / 10
const degToRad = value => Number(value || 0) * Math.PI / 180
const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
const lerp = (a, b, t) => a + (b - a) * t
const ease = t => t * t * (3 - 2 * t)
const normalizeInterpolation = value => ['smooth', 'linear', 'hold'].includes(value) ? value : 'smooth'
const segmentAmount = (key, amount) => key?.interpolation === 'hold' ? 0 : key?.interpolation === 'linear' ? amount : ease(amount)
const normalizeKeyframes = keys => (keys || []).map(key => ({ ...key, interpolation: normalizeInterpolation(key.interpolation) }))

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
    rigRoot: [0, 0, 0],
    joints: cloneJointPose(object.joints),
    footLock: Boolean(object.footLock),
    continuousMotion: Boolean(object.continuousMotion),
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
      rigRoot: [0, 0, 0],
      joints: cloneJointPose(key.joints),
    }
  })]))
}

function readCachedProject() {
  try {
    const current = localStorage.getItem(PROJECT_STORAGE_KEY)
    const legacy = current ? null : localStorage.getItem(LEGACY_PROJECT_STORAGE_KEY)
    const serialized = current || legacy
    const data = JSON.parse(serialized || 'null')
    if (!data || !Array.isArray(data.objects)) return null
    if (!current && legacy) localStorage.setItem(PROJECT_STORAGE_KEY, legacy)
    const tracks = data.objectKeyframes || data.characterKeyframes || {}
    return { ...data, settings: normalizeProjectSettings(data.settings), objects: data.objects.map(normalizePerson), keyframes: normalizeKeyframes(data.keyframes), objectKeyframes: normalizeObjectTracks(tracks) }
  } catch {
    return null
  }
}

function projectData({ settings, objects, camera, keyframes, objectKeyframes }) {
  return {
    version: PROJECT_VERSION,
    settings: normalizeProjectSettings(settings),
    objects,
    camera,
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
    target: left.target.map((value, index) => lerp(value, right.target[index], t)),
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
    rigRoot: [...rig.root],
    joints: cloneJointPose(rig.joints),
  }
}

function objectAtFrame(object, keyframes = [], frame) {
  const sorted = [...keyframes].sort((a, b) => a.frame - b.frame)
  if (!sorted.length) return object
  const applyKey = key => ({
    ...object,
    position: [...key.position],
    rotation: [...key.rotation],
    scale: [...key.scale],
    pose: normalizePoseId(key.pose || object.pose),
    poseTime: Number.isFinite(key.poseTime) ? key.poseTime : presetPhase(key.pose || object.pose),
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
  return {
    ...object,
    position: left.position.map((value, index) => lerp(value, right.position[index], t)),
    rotation: left.rotation.map((value, index) => lerp(value, right.rotation[index], t)),
    scale: left.scale.map((value, index) => lerp(value, right.scale[index], t)),
    pose: normalizePoseId(left.pose || object.pose),
    poseTime: lerp(leftPoseTime, rightPoseTime, t),
    rigRoot: leftRoot.map((value, index) => lerp(value, rightRoot[index], t)),
    joints: interpolateJointPose(
      left.joints || poseForObject({ ...object, pose: left.pose || object.pose }).joints,
      right.joints || poseForObject({ ...object, pose: right.pose || object.pose }).joints,
      t,
    ),
  }
}

function objectsAtFrame(objects, objectKeyframes, frame) {
  return objects.map(object => objectAtFrame(object, objectKeyframes[object.id], frame))
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

function NumberField({ label, value, onChange, accent, disabled = false }) {
  return (
    <label className="number-field">
      <span style={{ color: accent }}>{label}</span>
      <input type="number" step="0.1" value={Number(value.toFixed?.(2) ?? value)} onChange={event => onChange(Number(event.target.value))} disabled={disabled} />
    </label>
  )
}

function VectorFields({ title, value, onChange, degrees = false, disabled = false }) {
  const display = degrees ? value.map(radToDeg) : value
  const update = (index, next) => {
    const copy = [...display]
    copy[index] = next
    onChange(degrees ? copy.map(degToRad) : copy)
  }
  return (
    <div className="property-group">
      <div className="property-label">{title}</div>
      <div className="vector-row">
        <NumberField label="X" value={display[0]} onChange={value => update(0, value)} accent="#d7675b" disabled={disabled} />
        <NumberField label="Y" value={display[1]} onChange={value => update(1, value)} accent="#76a96c" disabled={disabled} />
        <NumberField label="Z" value={display[2]} onChange={value => update(2, value)} accent="#5d87c7" disabled={disabled} />
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

function LeftSidebar({ objects, selectedId, onSelect, onAddPerson, onAddPrimitive, onImport, onToggleVisible, onToggleLock }) {
  const [tab, setTab] = useState('assets')
  const inputRef = useRef(null)
  return (
    <aside className="left-sidebar panel">
      <div className="panel-tabs">
        <button className={tab === 'assets' ? 'is-active' : ''} onClick={() => setTab('assets')}>资源库</button>
        <button className={tab === 'scene' ? 'is-active' : ''} onClick={() => setTab('scene')}>场景层级</button>
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
      ) : (
        <SceneList objects={objects} selectedId={selectedId} onSelect={onSelect} onToggleVisible={onToggleVisible} onToggleLock={onToggleLock} />
      )}
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
    rigRoot: presetRoot(),
    joints: presetJoints(),
  })
  return (
    <aside className="right-sidebar panel">
      <div className="inspector-head">
        <div><small>{isCamera ? 'CAMERA' : typeLabel}</small>{isCamera ? <strong>主摄像机</strong> : <input className="inspector-name-input" value={selected.name} onChange={event => onUpdateObject({ name: event.target.value })} aria-label="物体名称" />}</div>
        <div className="inspector-head-actions">
          <ToolButton icon={Focus} label="聚焦" onClick={onFocus} />
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
          {!isCamera && <VectorFields title={selected.type === 'person' ? '整体旋转 · X 纵向 / Y 水平 / Z 翻滚' : '旋转'} value={selected.rotation} degrees onChange={rotation => onUpdateObject({ rotation })} disabled={selected.locked} />}
          {!isCamera && <VectorFields title="缩放" value={selected.scale} onChange={scale => onUpdateObject({ scale })} disabled={selected.locked} />}
          {isCamera && <VectorFields title="观察目标" value={camera.target} onChange={target => onUpdateCamera({ target })} />}
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
            <p className="pose-source-note">动作来源：Three.js 官方 X-Bot 骨骼动画。当前模型没有面部骨骼或表情，只提供身体、头颈和四肢动作。</p>
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
              <p className="joint-editor-hint">按 Q 后拖动青绿色的手脚控制点可摆放四肢末端；拖动人物其他部位或金色骨骼点可旋转单根骨骼。按住 Shift 左右拖可调整单骨骼扭转，也可使用 X/Y/Z 数值精确调整。</p>
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
        return <button key={key.frame} className={`keyframe ${kind} ${key.frame === currentFrame ? 'is-current' : ''} ${isSelected ? 'is-selected' : ''}`} data-interpolation={normalizeInterpolation(key.interpolation)} style={{ left: `${displayFrame / totalFrames * 100}%` }} title={`第 ${key.frame} 帧 · ${normalizeInterpolation(key.interpolation) === 'smooth' ? '平滑' : normalizeInterpolation(key.interpolation) === 'linear' ? '线性' : '保持'} · 拖动可移动`} onPointerDown={event => beginKeyDrag(event, key, kind, trackId)} onDoubleClick={event => { event.stopPropagation(); onDelete(key.frame); onSelectKeyframe(null) }} />
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
              <span>{selectedKeyframe.kind === 'camera' ? '镜头' : '物体'} · {selectedKeyframe.frame} 帧</span>
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
            <button className="keyframe-button object-keyframe-button" onClick={onAddObjectKeyframe}><Plus size={13} /> 物体关键帧</button>
          </>
        )}
      </div>
    </section>
  )
}

export default function App() {
  const startupProject = useMemo(() => readCachedProject(), [])
  const [settings, setSettings] = useState(() => normalizeProjectSettings(startupProject?.settings))
  const [objects, setObjects] = useState(() => startupProject?.objects || initialObjects)
  const [selectedId, setSelectedId] = useState(() => startupProject?.objects?.[0]?.id || 'actor-lead')
  const [selectedJoint, setSelectedJoint] = useState('mixamorigSpine2')
  const [transformMode, setTransformMode] = useState('translate')
  const [camera, setCamera] = useState(() => ({ ...initialCamera, ...(startupProject?.camera || {}) }))
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
  const [exportProgress, setExportProgress] = useState(0)
  const [showGrid, setShowGrid] = useState(true)
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
  const historyRef = useRef({ past: [], future: [], last: '', timer: null, restoring: false })
  const latestProjectRef = useRef(null)

  const fps = settings.fps
  const totalFrames = fps * settings.durationSeconds

  const selected = useMemo(() => selectedId === CAMERA_ID ? { id: CAMERA_ID } : objects.find(object => object.id === selectedId), [objects, selectedId])
  const activeObject = useMemo(() => selected?.id && selected.id !== CAMERA_ID ? selected : null, [selected])
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
    const framedObjects = hasObjectAnimation ? objectsAtFrame(objects, characterKeyframes, currentFrame) : objects
    return framedObjects.map(object => objectDrafts[object.id] || object)
  }, [hasObjectAnimation, objects, characterKeyframes, currentFrame, objectDrafts])
  const inspectorSelected = useMemo(() => selectedId === CAMERA_ID ? selected : animatedObjects.find(object => object.id === selectedId), [animatedObjects, selected, selectedId])
  const displayCamera = isAnimating ? animatedCamera : camera
  const previewAspect = aspectValue(displayCamera.aspectRatio)
  const previewAspectClass = previewAspect >= 16 / 9 ? 'is-wide' : 'is-tall'
  const exportDimensions = useMemo(() => exportDimensionsForAspect(camera.aspectRatio), [camera.aspectRatio])
  const currentProject = useMemo(() => projectData({
    settings,
    objects,
    camera,
    keyframes,
    objectKeyframes: characterKeyframes,
  }), [settings, objects, camera, keyframes, characterKeyframes])

  useEffect(() => {
    currentFrameRef.current = currentFrame
  }, [currentFrame])

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
    const snapshotSettings = normalizeProjectSettings(snapshot.settings)
    setSettings(snapshotSettings)
    setObjects(snapshot.objects || initialObjects)
    setCamera({ ...initialCamera, ...(snapshot.camera || {}) })
    setKeyframes(normalizeKeyframes(snapshot.keyframes || []))
    setCharacterKeyframes(normalizeObjectTracks(snapshot.objectKeyframes || snapshot.characterKeyframes || {}))
    setObjectDrafts({})
    setSelectedKeyframe(null)
    setPlaying(false)
    setCurrentFrame(frame => {
      const nextFrame = clamp(frame, 0, snapshotSettings.fps * snapshotSettings.durationSeconds)
      currentFrameRef.current = nextFrame
      return nextFrame
    })
    setSelectedId(current => current === CAMERA_ID || snapshot.objects?.some(object => object.id === current) ? current : snapshot.objects?.[0]?.id || CAMERA_ID)
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
      setViewFocusRequest({ position: [...camera.position], height: 0, distance: 4, nonce: Date.now() })
      return
    }
    const object = objects.find(item => item.id === selectedId)
    if (!object) return
    const maxScale = Math.max(...(object.scale || [1, 1, 1]).map(value => Math.abs(value) || 1))
    setViewFocusRequest({
      position: [...object.position],
      height: object.type === 'person' ? 1 : Math.min(maxScale * 0.45, 2),
      distance: clamp(maxScale * 4.5, 2.8, 14),
      nonce: Date.now(),
    })
  }, [camera.position, objects, selectedId])

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
    setCurrentFrame(frame => {
      const nextFrame = clamp(frame, 0, nextTotalFrames)
      currentFrameRef.current = nextFrame
      return nextFrame
    })
    setSettingsOpen(false)
    setToast(`镜头设置已更新 · ${next.fps} FPS · ${next.durationSeconds} 秒`)
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
      const source = drafts[id] || objectAtFrame(objects.find(object => object.id === id), characterKeyframes[id], currentFrame)
      return source ? { ...drafts, [id]: { ...source, ...patch } } : drafts
    })
    setObjects(list => list.map(object => object.id === id ? { ...object, ...patch } : object))
  }
  const updateSelected = patch => updateObjectById(selectedId, patch)
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
    const next = { frame: currentFrame, interpolation: normalizeInterpolation(existing?.interpolation), position: [...camera.position], target: [...camera.target], focalLength: camera.focalLength }
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
    setToast(`已记录“${activeObject.name}”第 ${currentFrame} 帧`)
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
    const data = projectData({ settings, objects, camera, keyframes, objectKeyframes: characterKeyframes })
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
    if (exporting || capturingImage) return
    setPlaying(false)
    setCapturingImage(true)
    imageCaptureCanvasRef.current = null
    try {
      const { width, height } = exportDimensions
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
      imageCaptureCanvasRef.current = null
    }
  }
  const handleExportMp4 = async () => {
    if (exporting || capturingImage) return
    const originalFrame = currentFrameRef.current
    const originalCamera = keyframes.length ? cameraAtFrame(keyframes, originalFrame, camera.aspectRatio) : camera
    let output

    setPlaying(false)
    setObjectDrafts({})
    setCamera(originalCamera)
    setExporting(true)
    setExportProgress(0)
    exportCanvasRef.current = null

    try {
      if (typeof VideoEncoder === 'undefined') throw new Error('当前浏览器不支持视频编码，请使用最新版 Chrome 或 Edge')
      const {
        BufferTarget, CanvasSource, Mp4OutputFormat, Output,
        QUALITY_HIGH, getFirstEncodableVideoCodec,
      } = await import('mediabunny')
      const { width, height } = exportDimensions
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
      exportCanvasRef.current = null
    }
  }
  const loadProject = event => {
    const file = event.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result)
        const loadedObjects = (data.objects || initialObjects).map(normalizePerson)
        const loadedTracks = normalizeObjectTracks(data.objectKeyframes || data.characterKeyframes || {})
        const loadedCameraKeys = normalizeKeyframes(data.keyframes || initialKeyframes)
        const maxLoadedFrame = Math.max(0, ...loadedCameraKeys.map(key => key.frame), ...Object.values(loadedTracks).flatMap(track => (track || []).map(key => key.frame)))
        const baseSettings = normalizeProjectSettings(data.settings)
        const loadedSettings = maxLoadedFrame > baseSettings.fps * baseSettings.durationSeconds
          ? { ...baseSettings, durationSeconds: clamp(Math.ceil(maxLoadedFrame / baseSettings.fps), 1, 60) }
          : baseSettings
        setSettings(loadedSettings)
        setObjects(loadedObjects)
        setCamera({ ...initialCamera, ...(data.camera || {}) })
        setKeyframes(loadedCameraKeys)
        setCharacterKeyframes(Object.keys(loadedTracks).length ? loadedTracks : fallbackCharacterKeyframes(loadedObjects))
        setObjectDrafts({})
        setSelectedKeyframe(null)
        setCurrentFrame(0)
        currentFrameRef.current = 0
        setPlaying(false)
        setSettingsOpen(false)
        setSelectedId(CAMERA_ID)
        setToast(`工程已打开 · ${loadedSettings.fps} FPS · ${loadedSettings.durationSeconds} 秒`)
      } catch { setToast('工程文件无法读取') }
    }
    reader.readAsText(file)
    event.target.value = ''
  }
  const resetProject = () => {
    setSettings(DEFAULT_PROJECT_SETTINGS)
    setObjects(initialObjects)
    setCamera(initialCamera)
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
        <div className="project-title"><i className={`status-dot ${saveStatus === '保存中…' ? '' : 'live'}`} /><button type="button" onClick={() => setSettingsOpen(true)} title="打开镜头设置"><span>{settings.name}</span><Settings2 size={12} /></button><small>{saveStatus}</small></div>
        <div className="export-actions">
          <button className="project-export-button" onClick={() => saveProject({ download: true })} disabled={exporting || capturingImage}><Download size={14} /> 导出工程</button>
          <button className="project-export-button capture-image-button" onClick={handleCaptureImage} disabled={exporting || capturingImage}><FileImage size={14} /> {capturingImage ? '截图中…' : '截图 PNG'}</button>
          <button className="export-button" onClick={handleExportMp4} disabled={exporting || capturingImage}><FileVideo2 size={14} /> {exporting ? `${exportProgress}%` : '导出 MP4'}</button>
        </div>
      </header>

      <div className="workspace">
        <LeftSidebar objects={objects} selectedId={selectedId} onSelect={setSelectedId} onAddPerson={addPerson} onAddPrimitive={addPrimitive} onImport={importModel} onToggleVisible={id => updateObjectById(id, { visible: objects.find(item => item.id === id)?.visible === false })} onToggleLock={id => updateObjectById(id, { locked: !objects.find(item => item.id === id)?.locked })} />
        <section className="viewport-shell">
          <div className="viewport-toolbar floating-panel">
            <ToolButton icon={MousePointer2} label="选择" active={!['translate', 'rotate', 'scale'].includes(transformMode)} onClick={() => setTransformMode('select')} shortcut="Q" />
            <span />
            <ToolButton icon={Move3D} label="移动" active={transformMode === 'translate'} onClick={() => setTransformMode('translate')} shortcut="W" />
            <ToolButton icon={RotateCw} label="旋转" active={transformMode === 'rotate'} onClick={() => setTransformMode('rotate')} shortcut="E" />
            <ToolButton icon={BoxSelect} label="缩放" active={transformMode === 'scale'} onClick={() => setTransformMode('scale')} shortcut="R" />
          </div>
          <div className="viewport-mode-help">
            {transformMode === 'select' && 'Q 人物摆姿 · 青色手脚 IK · 金色单骨骼 · Shift 扭转'}
            {transformMode === 'translate' && 'W 整体移动 · 拖动红 / 绿 / 蓝坐标轴'}
            {transformMode === 'rotate' && 'E 整体旋转 · 左右拖=水平 · 上下拖=纵向 · Shift 拖=翻滚'}
            {transformMode === 'scale' && 'R 整体缩放 · 拖动坐标轴或中心块'}
          </div>
          <div className="viewport-view-options floating-panel">
            <button className={showGrid ? 'is-active' : ''} onClick={() => setShowGrid(value => !value)}><Grid3X3 size={14} /> 网格</button>
            <button><span className="solid-sphere" /> 实体</button>
          </div>
          <div className="viewport-label"><strong>透视视图</strong><span>场景单位 · 世界坐标</span></div>
          <MainViewport objects={animatedObjects} animationTime={currentFrame / fps} selectedId={selectedId} activeJoint={selectedJoint} onSelect={setSelectedId} onJointSelect={(objectId, jointId) => { setSelectedId(objectId); setSelectedJoint(jointId) }} transformMode={transformMode} onUpdateObject={updateObjectById} cameraData={displayCamera} onUpdateCamera={patch => setCamera(current => ({ ...current, ...patch }))} showGrid={showGrid} focusRequest={viewFocusRequest} />
          <div className="navigation-hint"><span><MousePointer2 size={12} /> 左键选择</span><span>中键旋转视角</span><span>滚轮缩放</span></div>
          <div className="camera-monitor">
            <div className="monitor-head"><div><Video size={13} /><strong>摄像机 01</strong><span>SHOT PREVIEW</span></div><button onClick={() => setSelectedId(CAMERA_ID)}><ZoomIn size={13} /></button></div>
            <div className="monitor-frame">
              <div className={`monitor-canvas ${previewAspectClass}`} style={{ '--preview-aspect': previewAspect }}>
                <CameraPreview objects={animatedObjects} animationTime={currentFrame / fps} cameraData={displayCamera} />
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
          <CameraPreview objects={animatedObjects} animationTime={currentFrame / fps} cameraData={displayCamera} exportMode onCanvasReady={canvas => { imageCaptureCanvasRef.current = canvas }} />
        </div>
      )}
      {exporting && (
        <>
          <div className="export-render-surface" style={{ width: exportDimensions.width, height: exportDimensions.height }} aria-hidden="true">
            <CameraPreview objects={animatedObjects} animationTime={currentFrame / fps} cameraData={displayCamera} exportMode onCanvasReady={canvas => { exportCanvasRef.current = canvas }} />
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
