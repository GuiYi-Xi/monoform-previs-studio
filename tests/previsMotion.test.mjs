import test from 'node:test'
import assert from 'node:assert/strict'
import {pathToKeys} from '../src/previsMotion.js'
test('drawn path becomes timed position and heading keys including exact endpoint',()=>{
 const keys=pathToKeys([[0,0,0],[2,0,0],[2,0,-2]],0,60,{scale:[1,1,1],rotation:[0,0,0],pose:'idle'})
 assert.deepEqual(keys.map(x=>x.frame),[0,30,60]);assert.deepEqual(keys.at(-1).position,[2,0,-2]);assert.ok(keys[1].rotation[1]!==keys[0].rotation[1]);assert.equal(keys[0].interpolation,'linear')
})
test('zero length route rejected',()=>assert.throws(()=>pathToKeys([[0,0,0],[0,0,0]],0,24,{})))

test('long route is arc-length resampled without a terminal jump',()=>{
 const points=Array.from({length:140},(_,i)=>[i/10,0,Math.sin(i/8)*2])
 const keys=pathToKeys(points,0,240,{rotation:[0,0,0]},48)
 assert.equal(keys.length,48)
 assert.deepEqual(keys[0].position,points[0])
 assert.deepEqual(keys.at(-1).position,points.at(-1))
 const lastSegment=Math.hypot(...keys.at(-1).position.map((v,i)=>v-keys.at(-2).position[i]))
 assert.ok(lastSegment<2)
})
