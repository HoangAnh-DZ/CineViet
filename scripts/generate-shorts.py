"""Cut five real six-second clips from the existing licensed Big Buck Bunny sample.

Requires imageio-ffmpeg (PyPI) or FFMPEG_BINARY. See public/video/shorts/LICENSE.txt.
The full landscape picture remains visible over a blurred portrait background.
Output: H.264/AAC MP4, 540x960, 25fps, stereo sound, progressive fast-start.
"""
import os
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[1]
binary = os.environ.get("FFMPEG_BINARY")
if not binary:
    import imageio_ffmpeg
    binary = imageio_ffmpeg.get_ffmpeg_exe()
target = root / "public" / "video" / "shorts"
target.mkdir(parents=True, exist_ok=True)
source = Path(os.environ.get("SHORTS_SOURCE", root / "test-results" / "shorts-source" / "BigBuckBunny_640x360.m4v"))
if not source.is_file():
    raise SystemExit("Set SHORTS_SOURCE to the licensed full Big Buck Bunny source; see LICENSE.txt.")
layout = "[0:v]split[background][foreground];[background]scale=540:960:force_original_aspect_ratio=increase,crop=540:960,gblur=sigma=30,eq=brightness=-0.18[blur];[foreground]scale=540:-2[main];[blur][main]overlay=(W-w)/2:(H-h)/2,setsar=1,format=yuv420p[out]"
for index, start in enumerate([65, 130, 195, 260, 325], start=1):
    output = target / f"bunny-{index}.mp4"
    subprocess.run([binary, "-hide_banner", "-loglevel", "error", "-y", "-ss", str(start), "-i", str(source), "-filter_complex", layout, "-map", "[out]", "-map", "0:a:0", "-t", "6", "-r", "25", "-c:v", "libx264", "-preset", "fast", "-crf", "24", "-c:a", "aac", "-ac", "2", "-b:a", "96k", "-movflags", "+faststart", str(output)], check=True)
    subprocess.run([binary, "-hide_banner", "-loglevel", "error", "-y", "-ss", "0.5", "-i", str(output), "-frames:v", "1", "-update", "1", str(target / f"bunny-{index}.jpg")], check=True)
    print(f"Licensed motion clip: {output.name} ({output.stat().st_size} bytes)")
