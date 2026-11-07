"""Content-pack loader. Tax data is content with a version, never code."""
import json
from pathlib import Path

_CONTENT_DIR = Path(__file__).resolve().parent.parent / "content"
_cache: dict[str, dict] = {}


def load_pack(name: str) -> dict:
    """Load a content pack by file stem, e.g. 'federal-2026'."""
    if name not in _cache:
        path = _CONTENT_DIR / f"{name}.json"
        with path.open(encoding="utf-8") as fh:
            _cache[name] = json.load(fh)
    return _cache[name]


def federal_pack(year: int = 2026) -> dict:
    return load_pack(f"federal-{year}")


def states_pack(year: int = 2026) -> dict:
    return load_pack(f"states-{year}")


def _brackets(raw: list) -> list[tuple[float, float, float]]:
    """Convert JSON bracket rows [low, high|null, rate] to tuples with inf."""
    return [(float(low), float("inf") if high is None else float(high), float(rate))
            for low, high, rate in raw]
