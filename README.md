# MONOFORM · 素形白模预演工作台

MONOFORM 是一款面向分镜、构图和镜头预演的轻量三维白模工具。它运行在浏览器中，可搭建场景、摆放带骨骼人物、制作人物与摄像机关键帧，并导出画面或视频。

## 在线使用

[打开 MONOFORM](https://guiyi-xi.github.io/monoform-previs-studio/)

首次打开需要下载约数 MB 的人物模型，请稍等片刻。建议使用最新版 Chrome 或 Edge。

## 本地启动

Windows 用户可以双击项目根目录中的 `启动白模工具.cmd`。

也可以在 PowerShell 中运行：

```powershell
npm install
npm run dev
```

然后打开终端显示的本地地址。生成正式版本：

```powershell
npm run build
npm run preview
```

## 主要功能

- Three.js X-Bot 真人比例骨骼白模，支持多种体型和自定义颜色
- 67 根骨骼可编辑，可直接在人物上选择并拖动关节
- 内置 T 型、站立、行走、奔跑、低头含胸、点头和摇头等动作入口
- 方块、球体、圆柱和平面快速搭景，并支持导入 GLB / GLTF 模型
- 类 Blender 的移动、旋转、缩放控制器和数值编辑
- 独立摄像机监看窗口、焦距、观察目标和常用画面比例
- 摄像机、人物及场景物体关键帧，支持时间轴播放和平滑插值
- 当前摄像机画面导出 PNG，完整时间轴导出 MP4
- JSON 工程保存与打开、浏览器自动恢复、撤销与重做

## 常用操作

- `W`：移动
- `E`：旋转
- `R`：缩放
- `Q`：人物关节选择与调整
- `Ctrl + Z`：撤销
- `Ctrl + Y`：重做

新建工程和新增人物默认没有关键帧，需要用户主动添加。

## 数据与隐私

工程内容保存在浏览器本地或由用户手动导出。本项目不包含 GPT 识图、深度图重建或云端 API 密钥。

## 技术栈

React、Three.js、React Three Fiber、Vite、Mediabunny。

## 品牌

MONOFORM / 素形 · PREVIS STUDIO
