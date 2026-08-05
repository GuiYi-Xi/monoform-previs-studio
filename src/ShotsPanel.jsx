import { Camera, Copy, FileImage, Plus, Trash2 } from 'lucide-react'

export function ShotsPanel({ shots, activeShotId, onSelect, onAdd, onDuplicate, onDelete, onRename, onCapture }) {
  return (
    <div className="shots-panel">
      <div className="shots-panel-head">
        <div><strong>镜头列表</strong><small>{shots.length} {shots.length === 1 ? 'SHOT' : 'SHOTS'}</small></div>
        <button type="button" onClick={onAdd} disabled={shots.length >= 30}><Plus size={13} /> 新建镜头</button>
      </div>
      <div className="shots-list">
        {shots.map((shot, index) => {
          const active = shot.id === activeShotId
          return (
            <article className={`shot-card ${active ? 'is-active' : ''}`} key={shot.id}>
              <button type="button" className="shot-card-select" onClick={() => onSelect(shot.id)} aria-label={`切换到${shot.name}`}>
                <span className="shot-thumbnail">
                  {shot.thumbnail ? <img src={shot.thumbnail} alt={`${shot.name} 摄像机缩略图`} /> : <span><Camera size={18} /><i>等待截图</i></span>}
                  <b>{String(index + 1).padStart(2, '0')}</b>
                  {active && <em>ACTIVE</em>}
                </span>
              </button>
              <div className="shot-card-copy">
                <input
                  value={shot.name}
                  maxLength="30"
                  onChange={event => onRename(shot.id, event.target.value)}
                  onBlur={event => onRename(shot.id, event.target.value, true)}
                  onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }}
                  aria-label={`镜头 ${index + 1} 名称`}
                />
                <span>{shot.durationSeconds} 秒 · {shot.fps} FPS · {(shot.keyframes?.length || 0) + Object.values(shot.objectKeyframes || {}).reduce((sum, track) => sum + (track?.length || 0), 0)} 个关键帧</span>
              </div>
              <div className="shot-card-actions">
                <button type="button" title="更新当前镜头缩略图" aria-label="更新当前镜头缩略图" onClick={() => onCapture(shot.id)} disabled={!active}><FileImage size={12} /></button>
                <button type="button" title="复制镜头" aria-label={`复制${shot.name}`} onClick={() => onDuplicate(shot.id)} disabled={shots.length >= 30}><Copy size={12} /></button>
                <button type="button" title="删除镜头" aria-label={`删除${shot.name}`} onClick={() => onDelete(shot.id)} disabled={shots.length === 1}><Trash2 size={12} /></button>
              </div>
            </article>
          )
        })}
      </div>
      <p className="shots-panel-note">每个镜头独立保存场景、人物骨骼、摄像机和关键帧。切换镜头前会自动更新当前缩略图。</p>
    </div>
  )
}
