from __future__ import annotations

import json
import os
import shutil
import urllib.request
from pathlib import Path
from urllib.parse import quote

from mutagen.mp4 import MP4


DATA_PATH = Path(os.getenv("CONFIG_PATH", "/app/data/stimuli.json"))
CLIPS_PATH = Path(os.getenv("CLIPS_PATH", "/clips"))
SOURCE_BASE_URL = os.environ["CLIPS_SOURCE_BASE_URL"].rstrip("/")


def expected_clips() -> list[dict[str, object]]:
    config = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    clips = [clip for video in config["videos"] for clip in video["clips"]]
    return [
        *clips,
        {"file": "practice_1.mp4", "duration_sec": 8.0},
        {"file": "practice_2.mp4", "duration_sec": 8.0},
    ]


def is_valid(path: Path, expected_duration: float) -> bool:
    if not path.is_file() or path.stat().st_size == 0:
        return False
    try:
        return abs(float(MP4(path).info.length) - expected_duration) <= 0.04
    except Exception:
        return False


def main() -> None:
    CLIPS_PATH.mkdir(parents=True, exist_ok=True)
    for clip in expected_clips():
        filename = str(clip["file"])
        duration = float(clip["duration_sec"])
        destination = CLIPS_PATH / filename
        if is_valid(destination, duration):
            print(f"[clips] ready: {filename}")
            continue

        temporary = destination.with_suffix(destination.suffix + ".part")
        temporary.unlink(missing_ok=True)
        url = f"{SOURCE_BASE_URL}/{quote(filename)}"
        print(f"[clips] downloading: {filename}")
        request = urllib.request.Request(url, headers={"User-Agent": "ai-hints-media-seed/1.0"})
        with urllib.request.urlopen(request, timeout=180) as response, temporary.open("wb") as output:
            shutil.copyfileobj(response, output)
        if not is_valid(temporary, duration):
            temporary.unlink(missing_ok=True)
            raise RuntimeError(f"Downloaded clip failed validation: {filename}")
        temporary.replace(destination)

    print("[clips] all media files are ready")


if __name__ == "__main__":
    main()
