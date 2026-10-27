// Convert the perspective generator's Z-up scene to MONOFORM's Y-up editable objects.
// No case-specific scene names or coordinates: preserve one scale across all dimensions and the camera.
const color = value => /^#[0-9a-fA-F]{6}$/.test(value || '') ? value : '#d2d0ca'
const finite = value => Number.isFinite(Number(value)) ? Number(value) : 0
const copy = value => JSON.parse(JSON.stringify(value))

export function sceneToMonoform(scene, existingIds = [], prefix = 'generated') {
  if (!scene || !Array.isArray(scene.creations) || !Array.isArray(scene.walls)) throw Error('模型没有返回可编辑的体块和墙')
  const items = [...scene.creations, ...scene.walls]
  if (!items.length) throw Error('场景中没有可导入的几何结构')
  const points = items.flatMap(item => [item.a, item.b].filter(Boolean))
  const xs = points.map(p => finite(p.x)), ys = points.map(p => finite(p.y))
  const xmin = Math.min(...xs), xmax = Math.max(...xs), ymin = Math.min(...ys), ymax = Math.max(...ys)
  const centerX = (xmin + xmax) / 2, centerY = (ymin + ymax) / 2
  const factor = 18 / Math.max(18, xmax - xmin, ymax - ymin)
  const position = (x, y, z) => [(finite(x) - centerX) * factor, finite(z) * factor, -(finite(y) - centerY) * factor]
  const existing = new Set(existingIds)
  const newId = source => {
    let base = `${prefix}-${String(source || 'item').replace(/[^a-zA-Z0-9_-]/g, '_')}`
    let candidate = base, n = 2
    while (existing.has(candidate)) candidate = `${base}-${n++}`
    existing.add(candidate)
    return candidate
  }
  const objects = []
  const sourceIdToObjectId = {}
  for (const c of scene.creations) {
    const ax=finite(c.a?.x),ay=finite(c.a?.y),bx=finite(c.b?.x),by=finite(c.b?.y),h=finite(c.height),base=finite(c.baseZ)
    if (bx<=ax || by<=ay || h<=0) continue
    const id = newId(c.id)
    objects.push({id,name:String(c.name || c.id || '体块'),type:'box',position:position((ax+bx)/2,(ay+by)/2,base+h/2),rotation:[0,0,0],scale:[(bx-ax)*factor,h*factor,(by-ay)*factor],color:color(c.color),sourceSceneId:String(c.id||''),generatedScene:true})
    sourceIdToObjectId[String(c.id||'')] = id
  }
  for (const w of scene.walls) {
    const ax=finite(w.a?.x),ay=finite(w.a?.y),bx=finite(w.b?.x),by=finite(w.b?.y),h=finite(w.height)
    const length=Math.hypot(bx-ax,by-ay)
    if (length<=0 || h<=0) continue
    const id=newId(w.id)
    objects.push({id,name:String(w.name || w.id || '墙'),type:'box',position:position((ax+bx)/2,(ay+by)/2,h/2),rotation:[0,Math.atan2(by-ay,bx-ax),0],scale:[length*factor,h*factor,Math.max(.08, .18*factor)],color:color(w.color),sourceSceneId:String(w.id||''),generatedScene:true})
    sourceIdToObjectId[String(w.id||'')] = id
  }
  if(!objects.length) throw Error('所有几何体都无效，原工程保持不变')
  const sourceCam=scene.previs?.camera
  let camera=null
  if(Array.isArray(sourceCam?.position) && Array.isArray(sourceCam?.target) && sourceCam.position.length===3 && sourceCam.target.length===3){
    const eye=position(...sourceCam.position),target=position(...sourceCam.target)
    const fov=Math.max(18,Math.min(100,finite(sourceCam.fov)||45))
    camera={position:eye,target,focalLength:Math.max(18,Math.min(120,12/Math.tan(fov*Math.PI/360))),aspectRatio:'16:9'}
  }
  return {objects,camera,conversion:{factor,center:[centerX,centerY],sourceIdToObjectId},evidence:copy(scene.previs?.evidence || []),warnings:copy(scene.previs?.uncertainties || [])}
}
