#!/usr/bin/env python3
"""Merge nameEs + per-exercise videoUrlEs into assets/exercises/exercise_es_overrides.json.

Sources (in order, later wins):
  1. Catalog reuse: exercises.json videoUrl when YouTube and duration <= 60s
  2. scripts/es_video_batches/*.json — explicit per-exercise entries only
"""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EX_PATH = ROOT / "assets" / "exercises" / "exercises.json"
TSV_PATH = ROOT / "scripts" / "exercise_es_seed.tsv"
BATCH_DIR = ROOT / "scripts" / "es_video_batches"
OUT_PATH = ROOT / "assets" / "exercises" / "exercise_es_overrides.json"
DURATION_CACHE = ROOT / "scripts" / ".video_duration_cache.json"
MAX_DURATION_SEC = 60

# Catalog videoUrl is another movement or unusable; batch/manual must supply videoUrlEs.
FORCED_BATCH_OVERRIDE_IDS = frozenset({
    "l-sit",  # catalog points at handstand tutorial, not L-sit
})


def youtube_id(url: str) -> str | None:
    if not url:
        return None
    m = re.search(r"(?:v=|shorts/|youtu\.be/)([A-Za-z0-9_-]{11})", url)
    return m.group(1) if m else None


def watch_url(video_id: str) -> str:
    return f"https://www.youtube.com/watch?v={video_id}"


def load_duration_cache() -> dict[str, int | None]:
    if DURATION_CACHE.is_file():
        return json.loads(DURATION_CACHE.read_text())
    return {}


def save_duration_cache(cache: dict[str, int | None]) -> None:
    DURATION_CACHE.write_text(json.dumps(cache, indent=2) + "\n")


def get_duration(video_id: str, cache: dict[str, int | None]) -> int | None:
    if video_id in cache:
        return cache[video_id]
    try:
        import subprocess

        out = subprocess.check_output(
            [
                "yt-dlp",
                "--no-warnings",
                "--dump-json",
                "--skip-download",
                watch_url(video_id),
            ],
            stderr=subprocess.DEVNULL,
            timeout=30,
        )
        duration = json.loads(out).get("duration")
        cache[video_id] = duration
        return duration
    except Exception:
        cache[video_id] = None
        return None


def catalog_video_url(ex: dict, cache: dict[str, int | None]) -> str | None:
    url = ex.get("videoUrl") or ""
    if "musclewiki.com" in url or not url.startswith("http"):
        return None
    vid = youtube_id(url)
    if not vid:
        return None
    duration = get_duration(vid, cache)
    if duration is not None and duration <= MAX_DURATION_SEC:
        return watch_url(vid)
    return None


def load_batch_videos() -> dict[str, str]:
    videos: dict[str, str] = {}
    if not BATCH_DIR.is_dir():
        return videos
    for path in sorted(BATCH_DIR.glob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        for eid, entry in data.items():
            if isinstance(entry, str):
                videos[eid] = entry
            elif isinstance(entry, dict) and entry.get("videoUrlEs"):
                videos[eid] = entry["videoUrlEs"]
    return videos


def load_name_es() -> dict[str, str]:
    names: dict[str, str] = {}
    for line in TSV_PATH.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split("\t", 1)
        if len(parts) != 2:
            raise SystemExit(f"Bad TSV line: {line!r}")
        names[parts[0]] = parts[1].strip()
    return names


def main() -> None:
    exercises = json.loads(EX_PATH.read_text(encoding="utf-8"))["exercises"]
    names = load_name_es()
    cache = load_duration_cache()
    batch_videos = load_batch_videos()

    out: dict[str, dict[str, str]] = {}
    missing: list[str] = []

    for ex in exercises:
        eid = ex["id"]
        if eid not in names:
            raise SystemExit(f"Missing Spanish name for {eid}")

        catalog_url = None if eid in FORCED_BATCH_OVERRIDE_IDS else catalog_video_url(ex, cache)
        batch_url = batch_videos.get(eid)
        # Prefer catalog when valid (exercise-specific EN demo <=60s); else curated batch URL.
        video_url = catalog_url or batch_url
        if not video_url:
            missing.append(eid)
        else:
            out[eid] = {"nameEs": names[eid], "videoUrlEs": video_url}

    save_duration_cache(cache)

    if missing:
        raise SystemExit(
            f"Missing videoUrlEs for {len(missing)} exercises (add to es_video_batches/): "
            + ", ".join(missing[:20])
            + ("..." if len(missing) > 20 else "")
        )

    OUT_PATH.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(out)} entries to {OUT_PATH}")


if __name__ == "__main__":
    main()
