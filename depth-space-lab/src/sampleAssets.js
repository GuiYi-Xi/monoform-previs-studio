export function createSampleAssets() {
  const width = 1440
  const height = 900
  const colorCanvas = document.createElement('canvas')
  const depthCanvas = document.createElement('canvas')
  colorCanvas.width = depthCanvas.width = width
  colorCanvas.height = depthCanvas.height = height

  const color = colorCanvas.getContext('2d')
  const depth = depthCanvas.getContext('2d')

  const sky = color.createLinearGradient(0, 0, 0, height)
  sky.addColorStop(0, '#a4b9b5')
  sky.addColorStop(0.58, '#c9c5b5')
  sky.addColorStop(1, '#7c7566')
  color.fillStyle = sky
  color.fillRect(0, 0, width, height)

  const haze = color.createRadialGradient(1080, 210, 20, 1080, 210, 470)
  haze.addColorStop(0, 'rgba(247,224,177,.9)')
  haze.addColorStop(1, 'rgba(247,224,177,0)')
  color.fillStyle = haze
  color.fillRect(0, 0, width, height)

  color.fillStyle = '#6d786f'
  color.beginPath()
  color.moveTo(0, 545)
  color.lineTo(210, 350)
  color.lineTo(380, 500)
  color.lineTo(565, 300)
  color.lineTo(820, 535)
  color.lineTo(1050, 385)
  color.lineTo(1260, 515)
  color.lineTo(width, 410)
  color.lineTo(width, height)
  color.lineTo(0, height)
  color.fill()

  color.fillStyle = '#424941'
  color.beginPath()
  color.moveTo(0, 690)
  color.lineTo(260, 500)
  color.lineTo(515, 705)
  color.lineTo(770, 490)
  color.lineTo(1030, 700)
  color.lineTo(1270, 520)
  color.lineTo(width, 680)
  color.lineTo(width, height)
  color.lineTo(0, height)
  color.fill()

  color.fillStyle = '#b39058'
  color.beginPath()
  color.moveTo(350, height)
  color.quadraticCurveTo(690, 715, 850, 620)
  color.quadraticCurveTo(1080, 510, 1190, 420)
  color.lineTo(1280, 460)
  color.quadraticCurveTo(1100, 610, 900, 700)
  color.quadraticCurveTo(700, 805, 570, height)
  color.closePath()
  color.fill()

  color.fillStyle = '#202821'
  color.fillRect(180, 465, 16, 330)
  color.beginPath()
  color.arc(188, 420, 86, 0, Math.PI * 2)
  color.fill()
  color.beginPath()
  color.arc(125, 500, 58, 0, Math.PI * 2)
  color.arc(250, 500, 65, 0, Math.PI * 2)
  color.fill()

  const groundDepth = depth.createLinearGradient(0, 0, 0, height)
  groundDepth.addColorStop(0, '#202020')
  groundDepth.addColorStop(0.55, '#545454')
  groundDepth.addColorStop(1, '#bcbcbc')
  depth.fillStyle = groundDepth
  depth.fillRect(0, 0, width, height)

  depth.fillStyle = '#787878'
  depth.beginPath()
  depth.moveTo(0, 545)
  depth.lineTo(210, 350)
  depth.lineTo(380, 500)
  depth.lineTo(565, 300)
  depth.lineTo(820, 535)
  depth.lineTo(1050, 385)
  depth.lineTo(1260, 515)
  depth.lineTo(width, 410)
  depth.lineTo(width, height)
  depth.lineTo(0, height)
  depth.fill()

  depth.fillStyle = '#a4a4a4'
  depth.beginPath()
  depth.moveTo(0, 690)
  depth.lineTo(260, 500)
  depth.lineTo(515, 705)
  depth.lineTo(770, 490)
  depth.lineTo(1030, 700)
  depth.lineTo(1270, 520)
  depth.lineTo(width, 680)
  depth.lineTo(width, height)
  depth.lineTo(0, height)
  depth.fill()

  depth.fillStyle = '#eeeeee'
  depth.fillRect(180, 465, 16, 330)
  depth.beginPath()
  depth.arc(188, 420, 86, 0, Math.PI * 2)
  depth.arc(125, 500, 58, 0, Math.PI * 2)
  depth.arc(250, 500, 65, 0, Math.PI * 2)
  depth.fill()

  return {
    color: colorCanvas.toDataURL('image/jpeg', 0.92),
    depth: depthCanvas.toDataURL('image/png'),
    dimensions: { width, height },
  }
}
