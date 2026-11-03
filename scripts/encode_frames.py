#!/usr/bin/env python3
"""Encode a frame sequence from scripts/render_walk.mjs into an H.264 MP4 (r05 step 4 tooling).

Usage: py -3 scripts/encode_frames.py <render_dir> [--crf 16] [--out <file.mp4>]

Reads <render_dir>/walk-report.json for the frame rate and encodes <render_dir>/frames/frame-%06d.png
with libx264 (yuv420p, BT.709 tags) to <render_dir>/walk.mp4. The ffmpeg binary comes from the
imageio-ffmpeg package (requirements-render.txt); no system install is needed.
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

import imageio_ffmpeg


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("render_dir")
    ap.add_argument("--crf", type=int, default=16)
    ap.add_argument("--out")
    a = ap.parse_args()
    rdir = Path(a.render_dir)
    report = json.loads((rdir / "walk-report.json").read_text(encoding="utf-8"))
    if "error" in report:
        sys.exit(f"render failed, not encoding: {report['error']}")
    frames = sorted((rdir / "frames").glob("frame-*.png"))
    if len(frames) != report["frames"]:
        sys.exit(f"{len(frames)} frames on disk, report expects {report['frames']}; finish the render (--resume) first")
    out = Path(a.out) if a.out else rdir / "walk.mp4"
    cmd = [
        imageio_ffmpeg.get_ffmpeg_exe(), "-y", "-hide_banner", "-loglevel", "error",
        "-framerate", str(report["fps"]), "-i", str(rdir / "frames" / "frame-%06d.png"),
        "-c:v", "libx264", "-preset", "slow", "-crf", str(a.crf), "-pix_fmt", "yuv420p",
        "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
        "-movflags", "+faststart", str(out),
    ]
    subprocess.run(cmd, check=True)
    print(f"wrote {out} ({len(frames)} frames at {report['fps']} fps)")


if __name__ == "__main__":
    main()
