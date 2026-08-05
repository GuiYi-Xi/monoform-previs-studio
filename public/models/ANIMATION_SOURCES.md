# Animation sources

The `sit` and `wave` clips embedded in `xbot-animated.glb` are
retargeted from the Three.js `RobotExpressive.glb` example at commit
`6a644fe0cc3220c7bebf6acc96bb7e49d3274980`.

Original model and animations by Tomas Laulhe (Quaternius), licensed CC0 1.0.
Three.js source notes: https://github.com/mrdoob/three.js/tree/dev/examples/models/gltf/RobotExpressive

The pinned source GLB is stored at `scripts/assets/RobotExpressive.glb`, so the
retargeting step is reproducible offline. Run `npm run build:animations` to
regenerate the clips.
