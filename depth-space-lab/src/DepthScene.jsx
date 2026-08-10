import { forwardRef, Suspense, useEffect, useImperativeHandle, useMemo, useRef } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls, useTexture } from '@react-three/drei'
import * as THREE from 'three'

function CameraSettings({ fov }) {
  const { camera } = useThree()
  useEffect(() => {
    camera.fov = fov
    camera.updateProjectionMatrix()
  }, [camera, fov])
  return null
}

function ReliefPlane({ colorUrl, depthUrl, aspect, settings }) {
  const [colorMap, depthMap] = useTexture([colorUrl, depthUrl])
  const geometryKey = `${aspect}-${settings.quality}`

  useEffect(() => {
    colorMap.colorSpace = THREE.SRGBColorSpace
    colorMap.anisotropy = 8
    colorMap.needsUpdate = true
    depthMap.colorSpace = THREE.NoColorSpace
    depthMap.needsUpdate = true
  }, [colorMap, depthMap])

  const displacement = settings.invertDepth ? -settings.depthStrength : settings.depthStrength
  const displacementBias = settings.invertDepth ? settings.depthStrength * 0.5 : -settings.depthStrength * 0.5

  return (
    <mesh rotation={[0, 0, 0]}>
      <planeGeometry
        key={geometryKey}
        args={[4.2 * aspect, 4.2, settings.quality, settings.quality]}
      />
      <meshStandardMaterial
        map={colorMap}
        displacementMap={depthMap}
        displacementScale={displacement}
        displacementBias={displacementBias}
        wireframe={settings.wireframe}
        roughness={1}
        metalness={0}
        toneMapped={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  )
}

function LoadingPlane({ aspect }) {
  return (
    <mesh>
      <planeGeometry args={[4.2 * aspect, 4.2]} />
      <meshBasicMaterial color="#383934" wireframe />
    </mesh>
  )
}

export const DepthScene = forwardRef(function DepthScene(
  { colorUrl, depthUrl, dimensions, settings, onCanvasReady },
  ref,
) {
  const controlsRef = useRef(null)
  const canvasRef = useRef(null)
  const aspect = useMemo(
    () => Math.max(0.35, Math.min(3.5, dimensions.width / dimensions.height)),
    [dimensions],
  )

  useImperativeHandle(ref, () => ({
    resetView() {
      if (!controlsRef.current) return
      controlsRef.current.object.position.set(0, 0, 6.4)
      controlsRef.current.target.set(0, 0, 0)
      controlsRef.current.update()
    },
    exportImage() {
      const canvas = canvasRef.current
      if (!canvas) return null
      return canvas.toDataURL('image/png')
    },
  }))

  const halfAngle = THREE.MathUtils.degToRad(settings.viewAngle)
  const backgrounds = {
    studio: '#292b28',
    graphite: '#181917',
    black: '#080908',
  }

  return (
    <Canvas
      gl={{ antialias: true, preserveDrawingBuffer: true, alpha: false }}
      camera={{ position: [0, 0, 6.4], fov: settings.fov, near: 0.1, far: 100 }}
      dpr={[1, 2]}
      onCreated={({ gl }) => {
        canvasRef.current = gl.domElement
        onCanvasReady?.()
      }}
    >
      <color attach="background" args={[backgrounds[settings.background]]} />
      <CameraSettings fov={settings.fov} />
      <ambientLight intensity={2.35} />
      <directionalLight position={[-2, 4, 5]} intensity={1.15} />
      <Suspense fallback={<LoadingPlane aspect={aspect} />}>
        <ReliefPlane
          colorUrl={colorUrl}
          depthUrl={depthUrl}
          aspect={aspect}
          settings={settings}
        />
      </Suspense>
      <OrbitControls
        ref={controlsRef}
        makeDefault
        enableDamping
        dampingFactor={0.08}
        enablePan={false}
        minDistance={4.2}
        maxDistance={10}
        minAzimuthAngle={-halfAngle}
        maxAzimuthAngle={halfAngle}
        minPolarAngle={Math.PI / 2 - halfAngle * 0.72}
        maxPolarAngle={Math.PI / 2 + halfAngle * 0.72}
        rotateSpeed={0.42}
        zoomSpeed={0.65}
      />
    </Canvas>
  )
})
