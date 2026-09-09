"""Cut the three source videos into the 30 clips defined by stimuli.json."""
from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source_dir", type=Path)
    parser.add_argument("output_dir", type=Path)
    parser.add_argument("--config", type=Path, default=Path("data/stimuli.json"))
    args = parser.parse_args()

    config = json.loads(args.config.read_text(encoding="utf-8"))
    args.output_dir.mkdir(parents=True, exist_ok=True)

    for video in config["videos"]:
        source = args.source_dir / f"{video['id']}.mp4"
        if not source.exists():
            raise FileNotFoundError(source)
        start = 0.0
        for clip in video["clips"]:
            output = args.output_dir / clip["file"]
            duration = float(clip["duration_sec"])
            print(f"[{video['id']}] {start:.2f}-{start + duration:.2f} -> {output.name}", flush=True)
            subprocess.run(
                [
                    "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                    "-ss", f"{start:.3f}", "-i", str(source), "-t", f"{duration:.3f}",
                    "-c:v", "libx264", "-preset", "veryfast", "-crf", "21",
                    "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart",
                    str(output),
                ],
                check=True,
            )
            start += duration


if __name__ == "__main__":
    main()
