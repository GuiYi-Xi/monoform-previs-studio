import test from 'node:test'
import assert from 'node:assert/strict'
import {sceneToMonoform} from '../src/sceneToMonoform.js'

test('Z-up creations become independent editable Y-up boxes with color and relative size',()=>{
  const scene={walls:[],creations:[{id:'one',a:{x:0,y:0},b:{x:10,y:5},baseZ:0,height:3,color:'#aabbcc'},{id:'two',a:{x:10,y:5},b:{x:12,y:7},baseZ:3,height:2,color:'#ff0000'}],previs:{camera:{position:[0,-15,4],target:[6,4,3],fov:45},evidence:[{name:'主体',parts:['one']} ]}}
  const result=sceneToMonoform(scene,[],'test')
  assert.equal(result.objects.length,2)
  assert.equal(result.objects[0].type,'box')
  assert.equal(result.objects[0].color,'#aabbcc')
  assert.ok(result.objects[0].scale[0]>result.objects[1].scale[0])
  assert.ok(result.objects[1].position[1]>result.objects[0].position[1])
  assert.equal(result.camera.aspectRatio,'16:9')
  assert.deepEqual(result.camera.target.length,3)
  assert.notEqual(result.objects[0].id,result.objects[1].id)
})
test('walls keep length and angle in Z-up to Y-up conversion',()=>{
  const scene={creations:[],walls:[{id:'w',a:{x:0,y:0},b:{x:0,y:10},height:4,color:'#ffffff'}]}
  const result=sceneToMonoform(scene)
  assert.equal(result.objects.length,1)
  assert.ok(Math.abs(result.objects[0].rotation[1]-Math.PI/2)<1e-9)
  assert.ok(result.objects[0].scale[0]>0)
})
test('IDs avoid collisions and invalid-only scene never overwrites',()=>{
 const scene={walls:[],creations:[{id:'a',a:{x:0,y:0},b:{x:2,y:2},height:2,color:'#ffffff'}]}
 assert.notEqual(sceneToMonoform(scene,['generated-a']).objects[0].id,'generated-a')
 assert.throws(()=>sceneToMonoform({walls:[],creations:[]}))
})
