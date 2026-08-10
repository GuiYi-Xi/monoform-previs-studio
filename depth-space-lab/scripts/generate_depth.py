"""Generate a grayscale inverse-depth image with the MiDaS v2.1 small ONNX model."""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image, ImageFilter


IMAGENET_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
IMAGENET_STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="Input RGB image")
    parser.add_argument("output", type=Path, help="Output 8-bit grayscale PNG")
    parser.add_argument(
        "--model",
        type=Path,
        default=Path(".cache/models/midas-small.onnx"),
        help="MiDaS small ONNX model path",
    )
    parser.add_argument("--blur", type=float, default=1.35, help="Final Gaussian blur radius")
    return parser.parse_args()


def prepare(image: Image.Image) -> np.ndarray:
    resized = image.resize((256, 256), Image.Resampling.BICUBIC)
    array = np.asarray(resized, dtype=np.float32) / 255.0
    array = (array - IMAGENET_MEAN) / IMAGENET_STD
    return np.transpose(array, (2, 0, 1))[None].astype(np.float32)


def normalize_depth(prediction: np.ndarray) -> np.ndarray:
    finite = prediction[np.isfinite(prediction)]
    if finite.size == 0:
        raise RuntimeError("Model produced no finite depth values")
    low, high = np.percentile(finite, (2.0, 98.0))
    if high <= low:
        raise RuntimeError("Model produced a flat depth image")
    normalized = np.clip((prediction - low) / (high - low), 0.0, 1.0)
    normalized = np.power(normalized, 0.88)
    return np.round(normalized * 255.0).astype(np.uint8)


def flatten_image_border(depth: Image.Image) -> Image.Image:
    """Fade the outer frame to far depth so the relief keeps a clean silhouette."""
    array = np.asarray(depth, dtype=np.float32)
    height, width = array.shape
    x_margin = max(2, round(width * 0.045))
    y_margin = max(2, round(height * 0.025))
    x = np.minimum(np.arange(width), np.arange(width)[::-1]) / x_margin
    y = np.minimum(np.arange(height), np.arange(height)[::-1]) / y_margin
    feather = np.minimum(y[:, None], x[None, :])
    feather = np.clip(feather, 0.0, 1.0)
    feather = feather * feather * (3.0 - 2.0 * feather)
    return Image.fromarray(np.round(array * feather).astype(np.uint8), mode="L")


def main() -> None:
    args = parse_args()
    image = Image.open(args.input).convert("RGB")
    width, height = image.size

    # Loading bytes avoids Windows ONNX Runtime issues with non-ASCII model paths.
    session = ort.InferenceSession(
        args.model.read_bytes(),
        providers=["CPUExecutionProvider"],
    )
    input_name = session.get_inputs()[0].name
    prediction = session.run(None, {input_name: prepare(image)})[0]
    prediction = np.squeeze(prediction)
    depth = Image.fromarray(normalize_depth(prediction), mode="L")
    depth = depth.resize((width, height), Image.Resampling.BICUBIC)
    depth = flatten_image_border(depth)
    if args.blur > 0:
        depth = depth.filter(ImageFilter.GaussianBlur(radius=args.blur))

    args.output.parent.mkdir(parents=True, exist_ok=True)
    depth.save(args.output, format="PNG", optimize=True)
    print(f"saved={args.output} size={width}x{height}")


if __name__ == "__main__":
    main()
