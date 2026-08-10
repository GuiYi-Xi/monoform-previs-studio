import { useCallback, useMemo, useRef, useState } from 'react'
import {
  Check, ChevronDown, Download, FileImage, Focus, Grid3X3,
  Image as ImageIcon, RefreshCw, Rotate3D, SlidersHorizontal, Upload,
} from 'lucide-react'
import { DepthScene } from './DepthScene.jsx'
import { createSampleAssets } from './sampleAssets.js'

const defaultSettings = {
  depthStrength: 0.72,
  viewAngle: 14,
  fov: 44,
  quality: 192,
  invertDepth: false,
  wireframe: false,
  background: 'studio',
}

function readImage(file) {
  return new Promise((resolve, reject) => {
    if (!file?.type.startsWith('image/')) {
      reject(new Error('请选择 PNG、JPG 或 WebP 图片'))
      return
    }
    if (file.size > 30 * 1024 * 1024) {
      reject(new Error('图片不能超过 30 MB'))
      return
    }
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('图片读取失败'))
    reader.onload = () => {
      const image = new Image()
      image.onerror = () => reject(new Error('无法解析这张图片'))
      image.onload = () => resolve({
        url: reader.result,
        name: file.name,
        dimensions: { width: image.naturalWidth, height: image.naturalHeight },
      })
      image.src = reader.result
    }
    reader.readAsDataURL(file)
  })
}

function FileDrop({ kind, title, asset, onFile }) {
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef(null)

  const acceptFile = async file => {
    if (!file) return
    await onFile(file)
  }

  return (
    <section
      className={`file-card ${dragging ? 'is-dragging' : ''}`}
      onDragEnter={event => { event.preventDefault(); setDragging(true) }}
      onDragOver={event => event.preventDefault()}
      onDragLeave={() => setDragging(false)}
      onDrop={event => {
        event.preventDefault()
        setDragging(false)
        acceptFile(event.dataTransfer.files[0])
      }}
    >
      <button type="button" className="file-preview" onClick={() => inputRef.current?.click()}>
        <img src={asset.url} alt={title} />
        <span className="file-overlay"><Upload size={15} />替换</span>
      </button>
      <div className="file-meta">
        <span className="file-kind">{kind}</span>
        <strong title={asset.name}>{asset.name}</strong>
        <small>{asset.dimensions.width} × {asset.dimensions.height}</small>
      </div>
      <Check className="file-check" size={14} aria-label="已载入" />
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={event => acceptFile(event.target.files[0])}
      />
    </section>
  )
}

function RangeControl({ label, value, min, max, step, unit, onChange }) {
  return (
    <label className="range-control">
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={event => onChange(Number(event.target.value))}
      />
      <output>{value}{unit}</output>
    </label>
  )
}

function App() {
  const sample = useMemo(createSampleAssets, [])
  const [colorAsset, setColorAsset] = useState({ url: sample.color, name: '程序示例 · 原图', dimensions: sample.dimensions })
  const [depthAsset, setDepthAsset] = useState({ url: sample.depth, name: '程序示例 · 深度图', dimensions: sample.dimensions })
  const [settings, setSettings] = useState(defaultSettings)
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  const sceneRef = useRef(null)

  const updateSetting = useCallback((key, value) => {
    setSettings(current => ({ ...current, [key]: value }))
  }, [])

  const loadAsset = useCallback(async (file, setter) => {
    try {
      setError('')
      const image = await readImage(file)
      setter(image)
    } catch (loadError) {
      setError(loadError.message)
    }
  }, [])

  const resetAll = () => {
    setSettings(defaultSettings)
    sceneRef.current?.resetView()
  }

  const exportImage = () => {
    const imageUrl = sceneRef.current?.exportImage()
    if (!imageUrl) return
    const link = document.createElement('a')
    link.href = imageUrl
    link.download = 'depth-space-preview.png'
    link.click()
  }

  const mismatch = colorAsset.dimensions.width / colorAsset.dimensions.height !==
    depthAsset.dimensions.width / depthAsset.dimensions.height

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="identity">
          <span className="mark"><Grid3X3 size={16} /></span>
          <div>
            <strong>DEPTH SPACE LAB</strong>
            <small>2.5D IMAGE RELIEF</small>
          </div>
        </div>
        <div className="project-state">
          <span className={ready ? 'status-dot is-ready' : 'status-dot'} />
          {ready ? '实时预览已就绪' : '正在准备画布'}
        </div>
        <div className="top-actions">
          <button type="button" className="text-button" onClick={resetAll}><RefreshCw size={14} />重置</button>
          <button type="button" className="primary-button" onClick={exportImage}><Download size={14} />导出截图</button>
        </div>
      </header>

      <div className="workspace">
        <aside className="panel source-panel">
          <div className="panel-heading">
            <div><FileImage size={15} /><span><strong>输入素材</strong><small>COLOR + DEPTH</small></span></div>
            <span className="step-index">01</span>
          </div>
          <div className="panel-body">
            <p className="panel-note">深度图建议使用灰度图：白色靠近相机，黑色远离相机。</p>
            <FileDrop
              kind="COLOR"
              title="原图预览"
              asset={colorAsset}
              onFile={file => loadAsset(file, setColorAsset)}
            />
            <FileDrop
              kind="DEPTH"
              title="深度图预览"
              asset={depthAsset}
              onFile={file => loadAsset(file, setDepthAsset)}
            />
            {mismatch && <div className="inline-warning">两张图的宽高比不同，深度图会自动拉伸匹配原图。</div>}
            {error && <div className="inline-error" role="alert">{error}</div>}
          </div>
          <div className="panel-foot">
            <ImageIcon size={13} />支持 PNG / JPG / WebP，单张不超过 30 MB
          </div>
        </aside>

        <section className="stage" aria-label="三维深度预览">
          <DepthScene
            ref={sceneRef}
            colorUrl={colorAsset.url}
            depthUrl={depthAsset.url}
            dimensions={colorAsset.dimensions}
            settings={settings}
            onCanvasReady={() => setReady(true)}
          />
          <div className="stage-label">
            <span>LIVE RELIEF</span>
            <strong>{colorAsset.dimensions.width} × {colorAsset.dimensions.height}</strong>
          </div>
          <div className="axis-cue" aria-hidden="true">
            <i className="axis-y">Y</i><i className="axis-x">X</i><i className="axis-z">Z</i>
          </div>
          <div className="navigation-hint">
            <span><Rotate3D size={15} />左键拖拽旋转</span>
            <span><Focus size={15} />滚轮缩放</span>
          </div>
        </section>

        <aside className="panel controls-panel">
          <div className="panel-heading">
            <div><SlidersHorizontal size={15} /><span><strong>空间参数</strong><small>LIVE TWEAKS</small></span></div>
            <span className="step-index">02</span>
          </div>
          <div className="control-sections">
            <section className="control-group">
              <h2>深度塑形</h2>
              <RangeControl label="深度强度" value={settings.depthStrength} min={0} max={2} step={0.01} unit="" onChange={value => updateSetting('depthStrength', value)} />
              <label className="toggle-row">
                <span><strong>反转深度</strong><small>黑近白远</small></span>
                <input type="checkbox" checked={settings.invertDepth} onChange={event => updateSetting('invertDepth', event.target.checked)} />
              </label>
            </section>

            <section className="control-group">
              <h2>观察视角</h2>
              <RangeControl label="旋转范围" value={settings.viewAngle} min={4} max={28} step={1} unit="°" onChange={value => updateSetting('viewAngle', value)} />
              <RangeControl label="相机视场" value={settings.fov} min={28} max={68} step={1} unit="°" onChange={value => updateSetting('fov', value)} />
              <button type="button" className="wide-button" onClick={() => sceneRef.current?.resetView()}><Focus size={14} />视角归中</button>
            </section>

            <section className="control-group">
              <h2>显示质量</h2>
              <label className="select-row">
                <span>网格精度</span>
                <span className="select-wrap">
                  <select value={settings.quality} onChange={event => updateSetting('quality', Number(event.target.value))}>
                    <option value={96}>快速 · 96</option>
                    <option value={192}>平衡 · 192</option>
                    <option value={288}>精细 · 288</option>
                  </select>
                  <ChevronDown size={13} />
                </span>
              </label>
              <label className="toggle-row">
                <span><strong>显示线框</strong><small>检查网格形变</small></span>
                <input type="checkbox" checked={settings.wireframe} onChange={event => updateSetting('wireframe', event.target.checked)} />
              </label>
            </section>

            <section className="control-group">
              <h2>背景变体</h2>
              <div className="segmented-control">
                {[
                  ['studio', '工作室'],
                  ['graphite', '石墨'],
                  ['black', '纯黑'],
                ].map(([value, label]) => (
                  <button
                    type="button"
                    key={value}
                    className={settings.background === value ? 'is-active' : ''}
                    onClick={() => updateSetting('background', value)}
                  >{label}</button>
                ))}
              </div>
            </section>
          </div>
          <div className="panel-foot technical-readout">
            <span>MESH <b>{settings.quality}²</b></span>
            <span>DEPTH <b>{settings.depthStrength.toFixed(2)}</b></span>
            <span>ANGLE <b>±{settings.viewAngle}°</b></span>
          </div>
        </aside>
      </div>
    </main>
  )
}

export default App
