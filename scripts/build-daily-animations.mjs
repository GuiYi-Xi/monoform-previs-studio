import fs from 'node:fs'
import path from 'node:path'
import * as THREE from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

const ROOT = path.resolve(import.meta.dirname, '..')
const MODEL_PATH = path.join(ROOT, 'public', 'models', 'xbot-animated.glb')
const SOURCE_PATH = path.join(ROOT, 'scripts', 'assets', 'RobotExpressive.glb')
const FPS = 30

globalThis.ProgressEvent ??= class ProgressEvent {
  constructor(type, init = {}) {
    this.type = type
    Object.assign(this, init)
  }
}

globalThis.FileReader ??= class FileReader {
  result = null
  onloadend = null

  readAsArrayBuffer(blob) {
    return blob.arrayBuffer().then(result => {
      this.result = result
      queueMicrotask(() => this.onloadend?.({ target: this }))
      return result
    })
  }

  readAsDataURL(blob) {
    return blob.arrayBuffer().then(result => {
      this.result = `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(result).toString('base64')}`
      queueMicrotask(() => this.onloadend?.({ target: this }))
      return this.result
    })
  }
}

const BONE_MAP = {
  mixamorigHips: 'Body',
  mixamorigSpine: 'Hips',
  mixamorigSpine1: 'Abdomen',
  mixamorigSpine2: 'Torso_1',
  mixamorigNeck: 'Neck',
  mixamorigHead: 'Head',
  mixamorigLeftShoulder: 'ShoulderL',
  mixamorigLeftArm: 'UpperArmL',
  mixamorigLeftForeArm: 'LowerArmL',
  mixamorigRightShoulder: 'ShoulderR',
  mixamorigRightArm: 'UpperArmR',
  mixamorigRightForeArm: 'LowerArmR',
  mixamorigLeftUpLeg: 'UpperLegL',
  mixamorigLeftLeg: 'LowerLegL',
  mixamorigLeftFoot: 'FootL',
  mixamorigRightUpLeg: 'UpperLegR',
  mixamorigRightLeg: 'LowerLegR',
  mixamorigRightFoot: 'FootR',
  mixamorigLeftHandMiddle1: 'Middle1L',
  mixamorigLeftHandMiddle2: 'Middle2L',
  mixamorigLeftHandThumb1: 'ThumbL',
  mixamorigLeftHandThumb2: 'Thumb2L',
  mixamorigLeftHandIndex1: 'IndexL',
  mixamorigLeftHandIndex2: 'Index2L',
  mixamorigLeftHandRing1: 'Ring1L',
  mixamorigLeftHandRing2: 'Ring2L',
  mixamorigRightHandMiddle1: 'Middle1R',
  mixamorigRightHandMiddle2: 'Middle2R',
  mixamorigRightHandThumb1: 'ThumbR',
  mixamorigRightHandThumb2: 'Thumb2R',
  mixamorigRightHandIndex1: 'IndexR',
  mixamorigRightHandIndex2: 'Index2R',
  mixamorigRightHandRing1: 'Ring1R',
  mixamorigRightHandRing2: 'Ring2R',
}

const SOURCE_CLIPS = [
  ['Sitting', 'sit'],
  ['Wave', 'wave'],
]

function arrayBufferFromFile(filePath) {
  const buffer = fs.readFileSync(filePath)
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
}

function parseGlb(loader, arrayBuffer) {
  return new Promise((resolve, reject) => loader.parse(arrayBuffer, '', resolve, reject))
}

function snapshotBones(bones) {
  return new Map(bones.map(bone => [bone.name, {
    position: bone.position.clone(),
    quaternion: bone.quaternion.clone(),
    scale: bone.scale.clone(),
    worldPosition: bone.getWorldPosition(new THREE.Vector3()),
    worldQuaternion: bone.getWorldQuaternion(new THREE.Quaternion()),
  }]))
}

function restoreBones(bones, snapshot, scene) {
  for (const bone of bones) {
    const bind = snapshot.get(bone.name)
    bone.position.copy(bind.position)
    bone.quaternion.copy(bind.quaternion)
    bone.scale.copy(bind.scale)
  }
  scene.updateMatrixWorld(true)
}

function pushQuaternion(track, quaternion) {
  const values = track.values
  const previousOffset = values.length - 4
  if (previousOffset >= 0) {
    const dot = values[previousOffset] * quaternion.x
      + values[previousOffset + 1] * quaternion.y
      + values[previousOffset + 2] * quaternion.z
      + values[previousOffset + 3] * quaternion.w
    if (dot < 0) quaternion.set(-quaternion.x, -quaternion.y, -quaternion.z, -quaternion.w)
  }
  values.push(quaternion.x, quaternion.y, quaternion.z, quaternion.w)
}

function retargetClip({ targetScene, targetMesh, targetBase, sourceScene, sourceMesh, sourceModelBind, sourceClip, name }) {
  const targetBones = targetMesh.skeleton.bones
  const sourceBones = sourceMesh.skeleton.bones
  const sourceByName = new Map(sourceBones.map(bone => [bone.name, bone]))
  const targetHip = targetMesh.skeleton.getBoneByName('mixamorigHips')
  const sourceHip = sourceByName.get('Body')
  const targetFeet = ['mixamorigLeftFoot', 'mixamorigRightFoot'].map(boneName => targetMesh.skeleton.getBoneByName(boneName))
  const bindFootHeight = targetFeet.reduce((sum, foot) => sum + targetBase.get(foot.name).worldPosition.y, 0) / targetFeet.length
  const tracks = new Map(Object.keys(BONE_MAP).map(boneName => [boneName, { times: [], values: [] }]))
  const hipPositions = { times: [], values: [] }
  const mixer = new THREE.AnimationMixer(sourceScene)
  const action = mixer.clipAction(sourceClip)
  action.reset().setLoop(THREE.LoopOnce, 0)
  action.clampWhenFinished = true
  action.play()
  mixer.setTime(0)
  sourceScene.updateMatrixWorld(true)
  const sourceReference = snapshotBones(sourceBones)

  const frameCount = Math.ceil(sourceClip.duration * FPS) + 1
  for (let frame = 0; frame < frameCount; frame += 1) {
    const time = Math.min(sourceClip.duration, frame / FPS)
    mixer.setTime(time)
    sourceScene.updateMatrixWorld(true)
    restoreBones(targetBones, targetBase, targetScene)

    for (const targetBone of targetBones) {
      const sourceName = BONE_MAP[targetBone.name]
      if (!sourceName) continue
      const sourceBone = sourceByName.get(sourceName)
      const sourceRest = sourceReference.get(sourceName)
      const targetRest = targetBase.get(targetBone.name)
      const sourceWorld = sourceBone.getWorldQuaternion(new THREE.Quaternion())
      const worldDelta = sourceWorld.multiply(sourceRest.worldQuaternion.clone().invert())
      const desiredWorld = worldDelta.multiply(targetRest.worldQuaternion)
      const parentWorld = targetBone.parent.getWorldQuaternion(new THREE.Quaternion())
      targetBone.quaternion.copy(parentWorld.invert().multiply(desiredWorld)).normalize()

      if (targetBone === targetHip) {
        const sourceOffset = sourceHip.getWorldPosition(new THREE.Vector3()).sub(sourceReference.get('Body').worldPosition)
        const desiredPosition = targetRest.worldPosition.clone().add(sourceOffset)
        targetBone.position.copy(targetBone.parent.worldToLocal(desiredPosition))
      }
      targetBone.updateMatrixWorld(true)
    }

    targetScene.updateMatrixWorld(true)
    const currentFootHeight = targetFeet.reduce((sum, foot) => sum + foot.getWorldPosition(new THREE.Vector3()).y, 0) / targetFeet.length
    const hipWorld = targetHip.getWorldPosition(new THREE.Vector3())
    hipWorld.y += bindFootHeight - currentFootHeight
    targetHip.position.copy(targetHip.parent.worldToLocal(hipWorld))
    targetScene.updateMatrixWorld(true)

    for (const [boneName, track] of tracks) {
      const bone = targetMesh.skeleton.getBoneByName(boneName)
      track.times.push(time)
      pushQuaternion(track, bone.quaternion.clone())
    }
    hipPositions.times.push(time)
    hipPositions.values.push(targetHip.position.x, targetHip.position.y, targetHip.position.z)
  }

  mixer.stopAllAction()
  mixer.uncacheRoot(sourceScene)
  restoreBones(sourceBones, sourceModelBind, sourceScene)
  restoreBones(targetBones, targetBase, targetScene)

  const keyframeTracks = [
    new THREE.VectorKeyframeTrack('mixamorigHips.position', hipPositions.times, hipPositions.values),
    ...[...tracks].map(([boneName, track]) => new THREE.QuaternionKeyframeTrack(`${boneName}.quaternion`, track.times, track.values)),
  ]
  return new THREE.AnimationClip(name, sourceClip.duration, keyframeTracks)
}

async function main() {
  const loader = new GLTFLoader()
  const target = await parseGlb(loader, arrayBufferFromFile(MODEL_PATH))
  const source = await parseGlb(loader, arrayBufferFromFile(SOURCE_PATH))
  const targetMesh = target.scene.getObjectByName('Beta_Surface')
  const sourceMesh = source.scene.getObjectByName('HandR_1')
  if (!targetMesh?.isSkinnedMesh || !sourceMesh?.isSkinnedMesh) throw new Error('Expected source or target skeleton was not found')

  target.scene.updateMatrixWorld(true)
  source.scene.updateMatrixWorld(true)
  const targetModelBind = snapshotBones(targetMesh.skeleton.bones)
  const sourceModelBind = snapshotBones(sourceMesh.skeleton.bones)
  const idleClip = THREE.AnimationClip.findByName(target.animations, 'idle')
  const targetMixer = new THREE.AnimationMixer(target.scene)
  const idleAction = targetMixer.clipAction(idleClip)
  idleAction.reset().setLoop(THREE.LoopOnce, 0)
  idleAction.clampWhenFinished = true
  idleAction.play()
  targetMixer.setTime(idleClip.duration * 0.08)
  target.scene.updateMatrixWorld(true)
  const targetBase = snapshotBones(targetMesh.skeleton.bones)
  targetMixer.stopAllAction()
  targetMixer.uncacheRoot(target.scene)
  restoreBones(targetMesh.skeleton.bones, targetModelBind, target.scene)
  const generated = SOURCE_CLIPS.map(([sourceName, name]) => {
    restoreBones(sourceMesh.skeleton.bones, sourceModelBind, source.scene)
    const sourceClip = THREE.AnimationClip.findByName(source.animations, sourceName)
    if (!sourceClip) throw new Error(`Source clip ${sourceName} was not found`)
    return retargetClip({
      targetScene: target.scene,
      targetMesh,
      targetBase,
      sourceScene: source.scene,
      sourceMesh,
      sourceModelBind,
      sourceClip,
      name,
    })
  })

  const generatedNames = new Set([...generated.map(clip => clip.name), 'thumbs_up'])
  const animations = [...target.animations.filter(clip => !generatedNames.has(clip.name)), ...generated]
  restoreBones(targetMesh.skeleton.bones, targetModelBind, target.scene)
  const output = await new GLTFExporter().parseAsync(target.scene, {
    animations,
    binary: true,
    onlyVisible: false,
  })
  fs.writeFileSync(MODEL_PATH, Buffer.from(output))
  console.log(`Wrote ${MODEL_PATH}`)
  console.log(`Animations: ${animations.map(clip => clip.name).join(', ')}`)
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
