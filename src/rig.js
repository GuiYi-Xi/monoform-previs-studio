const BONE_PREFIX = 'mixamorig'

const bone = (name, label, group) => ({ id: `${BONE_PREFIX}${name}`, label, group })
const fingerBones = (side, sideLabel, finger, fingerLabel) => (
  Array.from({ length: 4 }, (_, index) => bone(`${side}Hand${finger}${index + 1}`, `${sideLabel}${fingerLabel} ${index + 1}`, `${sideLabel}手指`))
)

export const JOINT_DEFINITIONS = [
  bone('Hips', '骨盆', '躯干与头部'),
  bone('Spine', '脊柱 1', '躯干与头部'),
  bone('Spine1', '脊柱 2', '躯干与头部'),
  bone('Spine2', '胸椎', '躯干与头部'),
  bone('Neck', '颈部', '躯干与头部'),
  bone('Head', '头部', '躯干与头部'),
  bone('HeadTop_End', '头顶末端', '躯干与头部'),
  bone('LeftEye', '左眼', '躯干与头部'),
  bone('RightEye', '右眼', '躯干与头部'),

  bone('LeftShoulder', '左锁骨', '左臂'),
  bone('LeftArm', '左上臂', '左臂'),
  bone('LeftForeArm', '左前臂', '左臂'),
  bone('LeftHand', '左手掌', '左臂'),
  bone('RightShoulder', '右锁骨', '右臂'),
  bone('RightArm', '右上臂', '右臂'),
  bone('RightForeArm', '右前臂', '右臂'),
  bone('RightHand', '右手掌', '右臂'),

  bone('LeftUpLeg', '左大腿', '左腿'),
  bone('LeftLeg', '左小腿', '左腿'),
  bone('LeftFoot', '左脚', '左腿'),
  bone('LeftToeBase', '左脚趾', '左腿'),
  bone('LeftToe_End', '左脚趾末端', '左腿'),
  bone('RightUpLeg', '右大腿', '右腿'),
  bone('RightLeg', '右小腿', '右腿'),
  bone('RightFoot', '右脚', '右腿'),
  bone('RightToeBase', '右脚趾', '右腿'),
  bone('RightToe_End', '右脚趾末端', '右腿'),

  ...fingerBones('Left', '左', 'Thumb', '拇指'),
  ...fingerBones('Left', '左', 'Index', '食指'),
  ...fingerBones('Left', '左', 'Middle', '中指'),
  ...fingerBones('Left', '左', 'Ring', '无名指'),
  ...fingerBones('Left', '左', 'Pinky', '小指'),
  ...fingerBones('Right', '右', 'Thumb', '拇指'),
  ...fingerBones('Right', '右', 'Index', '食指'),
  ...fingerBones('Right', '右', 'Middle', '中指'),
  ...fingerBones('Right', '右', 'Ring', '无名指'),
  ...fingerBones('Right', '右', 'Pinky', '小指'),
]

export const JOINT_GROUPS = [...new Set(JOINT_DEFINITIONS.map(joint => joint.group))].map(label => ({
  label,
  joints: JOINT_DEFINITIONS.filter(joint => joint.group === label),
}))

// These clips are embedded in the official Three.js X-Bot GLB. No hand-authored
// Euler poses or skeleton retargeting are involved.
export const RIG_PRESETS = {
  idle: { clip: 'idle', phase: 0.08, duration: 2.5, loopable: true, label: '自然站立' },
  idle_shift: { clip: 'idle', phase: 0.58, label: '站立重心变化' },
  walk: { clip: 'walk', phase: 0.24, duration: 0.9666666388511658, loopable: true, label: '行走' },
  walk_contact_a: { clip: 'walk', phase: 0.04, label: '行走接触步 A' },
  walk_pass_a: { clip: 'walk', phase: 0.26, label: '行走跨步 A' },
  walk_contact_b: { clip: 'walk', phase: 0.52, label: '行走接触步 B' },
  walk_pass_b: { clip: 'walk', phase: 0.76, label: '行走跨步 B' },
  run: { clip: 'run', phase: 0.24, duration: 0.699999988079071, loopable: true, label: '奔跑' },
  run_push_a: { clip: 'run', phase: 0.05, label: '跑步蹬地 A' },
  run_air_a: { clip: 'run', phase: 0.26, label: '跑步腾空 A' },
  run_push_b: { clip: 'run', phase: 0.55, label: '跑步蹬地 B' },
  run_air_b: { clip: 'run', phase: 0.78, label: '跑步腾空 B' },
  sad_pose: { clip: 'sad_pose', phase: 1, label: '低头含胸（仅身体）' },
  agree: { clip: 'agree', phase: 0.48, duration: 1.8333333730697632, loopable: true, label: '点头动作（头颈）' },
  nod_down: { clip: 'agree', phase: 0.36, label: '点头低位' },
  nod_up: { clip: 'agree', phase: 0.72, label: '点头回正' },
  headShake: { clip: 'headShake', phase: 0.48, duration: 2.566666603088379, loopable: true, label: '摇头动作（头颈）' },
  shake_left: { clip: 'headShake', phase: 0.26, label: '摇头左侧' },
  shake_right: { clip: 'headShake', phase: 0.74, label: '摇头右侧' },
  tpose: { clip: null, phase: 0, label: 'T 型绑定姿态（官方骨架）' },
}

const LEGACY_PRESET_MAP = {
  relax: 'idle', sit: 'idle', kneel: 'idle', stretch: 'idle', lie: 'idle', sneak_pose: 'idle',
  fight: 'idle', punch: 'run', kick: 'run', pull: 'idle', push: 'idle', crouch: 'sneak_pose',
  sprint: 'run', jump: 'run', jumpAir: 'run', lunge: 'idle', balance: 'idle', landing: 'idle',
  vault: 'run', handstand: 'tpose', onehand: 'tpose', roll: 'idle', crawl: 'idle',
  plank: 'tpose', hang: 'tpose', reach: 'idle', wave: 'agree', custom: 'idle',
}

export function normalizePoseId(pose = 'idle') {
  return RIG_PRESETS[pose] ? pose : (LEGACY_PRESET_MAP[pose] || 'idle')
}

export function presetDefinition(pose = 'idle') {
  return RIG_PRESETS[normalizePoseId(pose)]
}

export function presetPhase(pose = 'idle') {
  return presetDefinition(pose).phase
}

export function poseCanLoop(pose = 'idle') {
  const preset = presetDefinition(pose)
  return Boolean(preset.loopable && preset.duration > 0)
}

export const RIG_PRESET_OPTIONS = Object.entries(RIG_PRESETS).map(([id, preset]) => [id, preset.label])

export const RIG_PRESET_GROUPS = [
  { label: '基础', poses: [['idle', '自然站立'], ['idle_shift', '重心变化'], ['tpose', 'T 型'], ['sad_pose', '低头含胸']] },
  { label: '持续动作', poses: [['walk', '行走循环'], ['run', '奔跑循环'], ['agree', '点头循环'], ['headShake', '摇头循环']] },
  { label: '行走定格', poses: [['walk_contact_a', '接触步 A'], ['walk_pass_a', '跨步 A'], ['walk_contact_b', '接触步 B'], ['walk_pass_b', '跨步 B']] },
  { label: '跑步定格', poses: [['run_push_a', '蹬地 A'], ['run_air_a', '腾空 A'], ['run_push_b', '蹬地 B'], ['run_air_b', '腾空 B']] },
  { label: '头部定格', poses: [['nod_down', '点头低位'], ['nod_up', '点头回正'], ['shake_left', '摇头左侧'], ['shake_right', '摇头右侧']] },
]

const emptyPose = () => Object.fromEntries(JOINT_DEFINITIONS.map(joint => [joint.id, [0, 0, 0]]))

export function cloneJointPose(joints) {
  const result = emptyPose()
  for (const { id } of JOINT_DEFINITIONS) {
    const rotation = joints?.[id]
    if (Array.isArray(rotation) && rotation.length >= 3) result[id] = rotation.slice(0, 3).map(value => Number(value) || 0)
  }
  return result
}

export function poseForObject(object) {
  return {
    root: Array.isArray(object?.rigRoot) ? object.rigRoot.slice(0, 3) : [0, 0, 0],
    joints: cloneJointPose(object?.joints),
  }
}

export function presetJoints() {
  return emptyPose()
}

export function presetRoot() {
  return [0, 0, 0]
}

export function interpolateJointPose(left, right, amount) {
  const leftPose = cloneJointPose(left)
  const rightPose = cloneJointPose(right)
  return Object.fromEntries(JOINT_DEFINITIONS.map(({ id }) => [
    id,
    leftPose[id].map((value, index) => value + (rightPose[id][index] - value) * amount),
  ]))
}
