# Depth Space Lab

一个独立的 Three.js / React 2.5D 深度空间实验项目。它不会引用或修改上级目录中 MONOFORM 项目的源码、资源和配置。

## 启动

Windows 可直接双击 `启动深度空间.cmd`。

也可以在终端执行：

```powershell
npm install
npm run dev
```

浏览器打开 Vite 输出的本地地址。项目内置一组程序生成的演示原图与深度图，也可以分别上传 PNG、JPG 或 WebP。

当前还内置了 `public/samples/minimax-h3/` 中的恐龙竖图实测素材，启动后默认载入，可在左侧切换回程序示例。

## 深度图约定

- 默认：白色靠近相机，黑色远离相机。
- 如果生成器输出相反，可打开“反转深度”。
- 原图与深度图最好拥有相同尺寸或至少相同宽高比。
- 这是单视图 2.5D 浮雕，不包含原图之外的侧面和背面信息，所以旋转范围应保持较小。

## 本地生成深度图

项目包含 `scripts/generate_depth.py`，可使用 MiDaS v2.1 small ONNX 模型生成灰度深度图。脚本需要 Pillow、NumPy 与 ONNX Runtime；模型文件默认放在 `.cache/models/midas-small.onnx`，不会提交到 Git。
