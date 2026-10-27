from __future__ import annotations

import base64
import json
import mimetypes
import os
import re
import urllib.error
import urllib.request
from email import policy
from email.parser import BytesParser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import sys
from typing import Any

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
from perspective_prompt import PROMPT as PERSPECTIVE_SCENE_PROMPT

WEB = ROOT.parent / "dist"
SKILLS = ROOT.parent / "skills"
KEY_FILE = Path(os.environ.get("MONOFORM_MODEL_KEY_FILE", r"F:\hermes-sceneTo 3d\model-key.txt"))
HOST = "127.0.0.1"
PORT = int(os.environ.get("MONOFORM_AI_PORT", "8891"))


CONFIG_OVERRIDE = ROOT / "model-config.local.json"


def load_model_config() -> dict[str, str]:
    values: dict[str, str] = {}
    if KEY_FILE.exists():
        for raw in KEY_FILE.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip()
    if CONFIG_OVERRIDE.exists():
        try:
            data = json.loads(CONFIG_OVERRIDE.read_text(encoding="utf-8"))
            values.update({key: str(value) for key, value in data.items() if key in ("base-url", "model", "api-key") and value})
        except (OSError, ValueError):
            pass
    return values


def save_model_config(patch: dict[str, Any]) -> dict[str, str]:
    current = load_model_config()
    for key in ("base-url", "model", "api-key"):
        value = patch.get(key)
        if value is not None and str(value).strip():
            current[key] = str(value).strip()
    CONFIG_OVERRIDE.write_text(json.dumps({key: current[key] for key in ("base-url", "model", "api-key") if current.get(key)}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return current


def public_model_config() -> dict[str, Any]:
    cfg = load_model_config()
    return {
        "baseUrl": cfg.get("base-url", ""),
        "model": cfg.get("model", ""),
        "apiKeyConfigured": bool(cfg.get("api-key")),
        "modelConfigured": all(cfg.get(k) for k in ("base-url", "api-key", "model")),
    }


def fetch_remote_models() -> list[dict[str, str]]:
    cfg = load_model_config()
    base_url = cfg.get("base-url", "").rstrip("/")
    api_key = cfg.get("api-key", "")
    if not base_url or not api_key:
        raise RuntimeError("请先配置 base-url 和 api-key")
    endpoint = base_url.rsplit("/chat/completions", 1)[0] + "/models" if base_url.endswith("/chat/completions") else base_url + "/models"
    request = urllib.request.Request(endpoint, headers={"Authorization": f"Bearer {api_key}", "HTTP-Referer": "http://127.0.0.1:5173", "X-Title": "MONOFORM Scene to White Model"})
    last_error: Exception | None = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                payload = json.loads(response.read().decode("utf-8"))
            rows = payload.get("data", payload if isinstance(payload, list) else [])
            return [{"id": str(row.get("id", "")), "name": str(row.get("name", row.get("id", "")))} for row in rows if isinstance(row, dict) and row.get("id")]
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", "replace")[:300]
            last_error = RuntimeError(f"上游模型服务 HTTP {exc.code}: {detail}")
            if exc.code < 500 or attempt == 2:
                raise last_error from exc
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            last_error = exc
            if attempt == 2:
                raise RuntimeError(f"上游模型服务连接失败: {str(exc)[:300]}") from exc
        if attempt < 2:
            import time
            time.sleep(1 + attempt)
    raise RuntimeError(f"拉取模型失败: {str(last_error)[:300]}")


def load_skill_prompt(filename: str) -> str:
    path = SKILLS / filename
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
        return str(doc.get("prompt", ""))
    except (OSError, json.JSONDecodeError):
        return ""


def strip_code_fence(text: str) -> str:
    text = text.strip()
    match = re.search(r"```(?:json)?\s*(.*?)\s*```", text, re.I | re.S)
    return match.group(1).strip() if match else text


def parse_json_from_model(text: str) -> Any:
    cleaned = strip_code_fence(text)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        start = min([i for i in (cleaned.find("{"), cleaned.find("[")) if i >= 0], default=-1)
        if start < 0:
            raise ValueError("模型没有返回 JSON")
        decoder = json.JSONDecoder()
        value, _ = decoder.raw_decode(cleaned[start:])
        return value


def normalize_scene(value: Any) -> dict[str, Any]:
    if isinstance(value, dict) and isinstance(value.get("workflow"), dict):
        value = value["workflow"].get("scene", value)
    elif isinstance(value, dict) and isinstance(value.get("scene"), dict):
        value = value["scene"]
    if not isinstance(value, dict):
        raise ValueError("模型返回的不是场景对象")
    scene = {
        "version": 2,
        "title": str(value.get("title", "AI白模场景"))[:80],
        "walls": value.get("walls", []),
        "rooms": value.get("rooms", []),
        "creations": value.get("creations", []),
        "actors": value.get("actors", []),
        "props": value.get("props", []),
        "lights": value.get("lights", []),
        "sun": value.get("sun", {"enabled": True, "visible": False, "azimuth": 308, "elevation": 53}),
        "groundColor": value.get("groundColor", "#e5e5e5"),
        "roofEnabled": bool(value.get("roofEnabled", False)),
    }
    # Keep the perspective calibration and evidence: the viewer needs the same
    # camera that the model used, and QA needs an auditable structure map.
    if isinstance(value.get("previs"), dict):
        scene["previs"] = value["previs"]
    return scene


def validate_scene_structure(scene: dict[str, Any]) -> list[str]:
    """Return concrete warnings instead of treating parseable JSON as a pass."""
    warnings: list[str] = []
    ids: list[str] = []
    for group in ("walls", "rooms", "creations", "actors", "props", "lights"):
        for item in scene.get(group, []):
            if isinstance(item, dict) and item.get("id"):
                ids.append(str(item["id"]))
    duplicates = sorted({item for item in ids if ids.count(item) > 1})
    if duplicates:
        warnings.append("ID重复: " + ", ".join(duplicates[:8]))
    creations = scene.get("creations", [])
    for item in creations:
        if not isinstance(item, dict):
            warnings.append("creations 中存在非对象项")
            continue
        a, b = item.get("a", {}), item.get("b", {})
        if not (b.get("x", 0) > a.get("x", 0) and b.get("y", 0) > a.get("y", 0)):
            warnings.append(f"体块 {item.get('id', '?')} 的 a/b 不是有效矩形")
        if not isinstance(item.get("height"), (int, float)) or item["height"] <= 0 or item["height"] > 40:
            warnings.append(f"体块 {item.get('id', '?')} 高度必须 >0 且 ≤40 格")
    previs = scene.get("previs", {})
    camera = previs.get("camera") if isinstance(previs, dict) else None
    if not isinstance(camera, dict) or not all(isinstance(camera.get(k), list) and len(camera[k]) == 3 for k in ("position", "target")):
        warnings.append("缺少可用于同机位回放的 previs.camera")
    composition = previs.get("imageComposition") if isinstance(previs, dict) else None
    if not isinstance(composition, dict):
        warnings.append("缺少 imageComposition，无法审计主体在画面中的相对大小")
    evidence = previs.get("evidence", []) if isinstance(previs, dict) else []
    known = set(ids)
    referenced = {str(ref) for entry in evidence if isinstance(entry, dict) for ref in entry.get("parts", [])}
    for item in creations:
        if isinstance(item, dict) and item.get("baseZ", 0) > 0 and not item.get("support") and str(item.get("id")) not in referenced:
            warnings.append(f"体块 {item.get('id', '?')} 悬空且未被结构证据引用")
    for entry in evidence:
        if not isinstance(entry, dict):
            continue
        missing = [str(ref) for ref in entry.get("parts", []) if str(ref) not in known]
        if missing:
            warnings.append(f"结构证据 {entry.get('name', '?')} 引用了不存在的部件: {', '.join(missing[:5])}")
        screen = entry.get("screen")
        if not isinstance(screen, dict) or not isinstance(screen.get("bbox"), list) or len(screen.get("bbox", [])) != 4:
            warnings.append(f"结构证据 {entry.get('name', '?')} 缺少 screen.bbox")
    if not evidence:
        warnings.append("缺少主要结构 evidence，不能审计主物体是否被遗漏")
    return list(dict.fromkeys(warnings))


def repair_scene_geometry(scene: dict[str, Any]) -> list[str]:
    """Make thin structural proxies renderable without inventing detail.

    Repairs are explicitly recorded because a zero-width column is a model/schema
    error, not evidence that the source had no width.
    """
    corrections: list[str] = []
    for item in scene.get("creations", []):
        if not isinstance(item, dict):
            continue
        a, b = item.get("a", {}), item.get("b", {})
        if b.get("x", 0) <= a.get("x", 0):
            b["x"] = a.get("x", 0) + 0.5
            corrections.append(f"{item.get('id', '?')}.b.x: zero-width proxy widened to 0.5")
        if b.get("y", 0) <= a.get("y", 0):
            b["y"] = a.get("y", 0) + 0.5
            corrections.append(f"{item.get('id', '?')}.b.y: zero-depth proxy widened to 0.5")
        height = item.get("height")
        if isinstance(height, (int, float)) and height <= 0:
            item["height"] = 0.5
            corrections.append(f"{item.get('id', '?')}.height: non-positive proxy raised to 0.5")
    if corrections:
        scene.setdefault("previs", {}).setdefault("corrections", []).extend(corrections)
    return corrections


def normalize_perspective_response(value: Any) -> tuple[dict[str, Any], list[str]]:
    scene = normalize_scene(value)
    repair_scene_geometry(scene)
    warnings = validate_scene_structure(scene)
    # Output counts are diagnostics, not fidelity gates. A simple white model is
    # allowed as long as its camera and structure evidence are auditable.
    if any("缺少可用于同机位" in w or "缺少主要结构" in w for w in warnings):
        raise ValueError("模型结果缺少相机或主体结构证据；原工程保持不变")
    # Screen boxes are useful for later QA, but not required to edit the spatial
    # proxies in MONOFORM. Keep the warning; do not throw away usable geometry.
    return scene, warnings


def chat_json(system_prompt: str, user_text: str, image: bytes | None = None, mime: str = "image/png") -> Any:
    cfg = load_model_config()
    base_url = cfg.get("base-url", "").rstrip("/")
    api_key = cfg.get("api-key", "")
    model = cfg.get("model", "")
    if not base_url or not api_key or not model:
        raise RuntimeError("model-key.txt 缺少 base-url、api-key 或 model")
    endpoint = base_url if base_url.endswith("/chat/completions") else base_url + "/chat/completions"
    content: list[dict[str, Any]] = [{"type": "text", "text": user_text}]
    if image:
        encoded = base64.b64encode(image).decode("ascii")
        content.append({"type": "image_url", "image_url": {"url": f"data:{mime};base64,{encoded}"}})
    payload = {
        "model": model,
        "temperature": 0.1,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": content},
        ],
    }
    req = urllib.request.Request(
        endpoint,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "http://127.0.0.1:5173",
            "X-Title": "MONOFORM Scene to White Model",
        },
        method="POST",
    )
    last_error: Exception | None = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=180) as response:
                raw = response.read()
            break
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", "replace")[:1000]
            # Retry transient upstream failures, but surface client/config errors immediately.
            if exc.code < 500 or attempt == 2:
                raise RuntimeError(f"模型服务 HTTP {exc.code}: {detail}") from exc
            last_error = exc
        except (urllib.error.URLError, ConnectionError, TimeoutError) as exc:
            last_error = exc
        if attempt < 2:
            import time
            time.sleep(2 ** attempt)
    else:
        raise RuntimeError(f"模型服务连接失败（已重试3次）: {last_error}") from last_error
    result = json.loads(raw.decode("utf-8"))
    content_out = result["choices"][0]["message"]["content"]
    if isinstance(content_out, list):
        content_out = "".join(str(x.get("text", "")) for x in content_out if isinstance(x, dict))
    return parse_json_from_model(str(content_out))


def scene_system_prompt() -> str:
    # Perspective photos need their own camera and structure contract. Appending
    # the scene-only skill here contradicted the required previs field.
    return PERSPECTIVE_SCENE_PROMPT


def pose_system_prompt() -> str:
    return load_skill_prompt("图片或描述 → 生成人物姿势.json") + """
\n【白模预演扩展】
只输出完整的 miorning-adult-pose JSON，不要解释、Markdown 或代码围栏。若仅有动作文字，使用自然、保守且能保持重心的姿势。"""


def object_system_prompt() -> str:
    return load_skill_prompt("描述或图片 → 生成可调物体.json")


def parse_multipart(handler: BaseHTTPRequestHandler) -> dict[str, tuple[str, str, bytes]]:
    content_type = handler.headers.get("Content-Type", "")
    length = int(handler.headers.get("Content-Length", "0"))
    body = handler.rfile.read(length)
    message = BytesParser(policy=policy.default).parsebytes(
        (f"Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n").encode() + body
    )
    result: dict[str, tuple[str, str, bytes]] = {}
    for part in message.iter_parts():
        disposition = part.get("Content-Disposition", "")
        name_match = re.search(r'name="([^"]+)"', disposition)
        if not name_match:
            continue
        name = name_match.group(1)
        filename = part.get_filename() or ""
        result[name] = (filename, part.get_content_type(), part.get_payload(decode=True) or b"")
    return result


class Handler(BaseHTTPRequestHandler):
    server_version = "MiorningPrevis/0.1"

    def log_message(self, fmt: str, *args: Any) -> None:
        print(f"[{self.address_string()}] {fmt % args}")

    def send_json(self, status: int, value: Any) -> None:
        data = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:
        if self.path == "/api/health":
            cfg = load_model_config()
            self.send_json(200, {"ok": True, "modelConfigured": all(cfg.get(k) for k in ("base-url", "api-key", "model"))})
            return
        if self.path == "/api/model-config":
            self.send_json(200, public_model_config())
            return
        if self.path == "/api/models":
            try:
                self.send_json(200, {"models": fetch_remote_models(), **public_model_config()})
            except Exception as exc:
                self.send_json(502, {"error": f"拉取模型列表失败: {str(exc)[:500]}"})
            return
        path = self.path.split("?", 1)[0]
        if path == "/":
            path = "/index.html"
        requested = (WEB / path.lstrip("/")).resolve()
        if WEB not in requested.parents or not requested.is_file():
            self.send_error(404)
            return
        content_type = "application/javascript" if requested.suffix == ".mjs" else (mimetypes.guess_type(str(requested))[0] or "application/octet-stream")
        data = requested.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type + ("; charset=utf-8" if content_type.startswith("text/") else ""))
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self) -> None:
        try:
            if self.path == "/api/model-config":
                length = int(self.headers.get("Content-Length", "0"))
                if length <= 0 or length > 8192:
                    self.send_json(400, {"error": "模型设置请求无效"})
                    return
                payload = json.loads(self.rfile.read(length).decode("utf-8"))
                if not isinstance(payload, dict):
                    self.send_json(400, {"error": "模型设置格式无效"})
                    return
                base_url = str(payload.get("base-url", "")).strip()
                if base_url and not (base_url.startswith("https://") or base_url.startswith("http://127.0.0.1:")):
                    self.send_json(400, {"error": "API 地址必须是 HTTPS 或本机地址"})
                    return
                model = str(payload.get("model", "")).strip()
                if len(model) > 180:
                    self.send_json(400, {"error": "模型 ID 不能超过 180 个字符"})
                    return
                save_model_config(payload)
                self.send_json(200, public_model_config())
                return
            if self.path == "/api/generate-scene":
                fields = parse_multipart(self)
                image = fields.get("image", ("", "image/png", b""))
                prompt = fields.get("prompt", ("", "text/plain", b""))[2].decode("utf-8", "replace")
                if not image[2]:
                    self.send_json(400, {"error": "请先上传场景图"})
                    return
                request_text = "请根据上传的场景图生成白模场景。用户补充要求：" + (prompt or "无")
                # A camera, composition, and structure evidence are required before the
                # result can replace the current scene; support warnings are review-only.
                scene, warnings = normalize_perspective_response(chat_json(scene_system_prompt(), request_text, image[2], image[1]))
                quality = {"status": "review" if warnings else "ready", "visualCheck": "outstanding", "warnings": warnings, "corrections": scene.get("previs", {}).get("corrections", [])}
                self.send_json(200, {"scene": scene, "warnings": warnings, "quality": quality})
                return
            if self.path == "/api/generate-pose":
                length = int(self.headers.get("Content-Length", "0"))
                payload = json.loads(self.rfile.read(length).decode("utf-8"))
                pose = chat_json(pose_system_prompt(), str(payload.get("prompt", "生成自然站立姿势")))
                self.send_json(200, {"pose": pose})
                return
            if self.path == "/api/generate-object":
                length = int(self.headers.get("Content-Length", "0"))
                payload = json.loads(self.rfile.read(length).decode("utf-8"))
                obj = chat_json(object_system_prompt(), str(payload.get("prompt", "设计一个简单的可调白模物体")))
                self.send_json(200, {"object": obj})
                return
            self.send_json(404, {"error": "未知 API"})
        except Exception as exc:  # API errors are shown in the UI; no key is included here.
            self.send_json(502, {"error": str(exc)[:2000]})


if __name__ == "__main__":
    print(f"Miorning White-Model Previs: http://{HOST}:{PORT}")
    print(f"Model config: {'ready' if load_model_config() else 'missing'}")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
