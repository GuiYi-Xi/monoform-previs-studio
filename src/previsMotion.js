// Pure geometry for drawing an actor's ground-plane route and timing keyframes.
export const distance3 = (a,b) => Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2])
export function pathToKeys(points, startFrame, endFrame, template, maxKeys=48) {
  if(!Array.isArray(points)||points.length<2) throw Error('请在地面上拖出至少两个点')
  if(!Number.isFinite(startFrame)||!Number.isFinite(endFrame)||endFrame<=startFrame) throw Error('轨迹结束时间必须晚于开始时间')
  const sampled=points.filter((p,i)=>i===0||distance3(p,points[i-1])>.02)
  if(sampled.length<2) throw Error('轨迹太短')
  const lengths=[0];for(let i=1;i<sampled.length;i++)lengths.push(lengths.at(-1)+distance3(sampled[i],sampled[i-1]))
  const total=lengths.at(-1)
  if(total<=.02) throw Error('轨迹太短')
  // Resample by arc length instead of dropping points after maxKeys. The old
  // implementation kept the first 47 points and then jumped directly to the
  // endpoint, which made long routes visibly skip their final bends.
  const count=Math.max(2,Math.min(maxKeys,sampled.length,Math.round(endFrame-startFrame)+1))
  const sampleAtDistance=distance=>{
    const target=Math.max(0,Math.min(total,distance))
    let right=lengths.findIndex(value=>value>=target)
    if(right<=0)return [...sampled[0]]
    if(right<0)return [...sampled.at(-1)]
    const left=right-1
    const span=Math.max(.000001,lengths[right]-lengths[left])
    const amount=(target-lengths[left])/span
    return sampled[left].map((value,index)=>value+(sampled[right][index]-value)*amount)
  }
  const result=[]
  for(let index=0;index<count;index++){
    const amount=index/(count-1)
    const distance=total*amount
    const position=sampleAtDistance(distance)
    const before=sampleAtDistance(Math.max(0,distance-total/Math.max(2,count-1)))
    const after=sampleAtDistance(Math.min(total,distance+total/Math.max(2,count-1)))
    const heading=Math.atan2(after[0]-before[0],after[2]-before[2])
    const rotation=[...(template.rotation||[0,0,0])];rotation[1]=heading
    const frame=index===count-1?endFrame:startFrame+Math.round((endFrame-startFrame)*amount)
    result.push({...template,frame,position,rotation,interpolation:'linear'})
  }
  return result
}
