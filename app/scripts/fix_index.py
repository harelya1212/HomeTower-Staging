#!/usr/bin/env python3
"""Post-export fix for the web build (TReps lesson, AGENTS.md 2026-11-06):
Expo's web export index.html carries NO iOS web-app tags, so an installed
home-screen app gets a generic icon and no Notification API. This script
injects the tags on every deploy and generates the icon set from the
owner's logo mark. The manifest ships as app.webmanifest, NEVER as
manifest.json (a manifest.json at the Pages root breaks the Pages build).

Usage: python3 scripts/fix_index.py [dist-dir]   (default: dist)
"""
import json
import sys
from pathlib import Path

from PIL import Image

APP_DIR = Path(__file__).resolve().parent.parent
DIST = Path(sys.argv[1]) if len(sys.argv) > 1 else APP_DIR / "dist"
BASE = "/HomeTower-Staging"

mark = Image.open(APP_DIR / "assets" / "logo-mark.png").convert("RGBA")
white = Image.new("RGBA", mark.size, (255, 255, 255, 255))
white.alpha_composite(mark)

for name, size in (("apple-touch-icon.png", 180), ("icon-192.png", 192), ("icon-512.png", 512), ("favicon.png", 64)):
    white.resize((size, size), Image.LANCZOS).convert("RGB").save(DIST / name)

manifest = {
    "name": "HomeTower",
    "short_name": "HomeTower",
    "start_url": f"{BASE}/",
    "scope": f"{BASE}/",
    "display": "standalone",
    "background_color": "#0B2A4A",
    "theme_color": "#0B2A4A",
    "icons": [
        {"src": f"{BASE}/icon-192.png", "sizes": "192x192", "type": "image/png"},
        {"src": f"{BASE}/icon-512.png", "sizes": "512x512", "type": "image/png"},
    ],
}
(DIST / "app.webmanifest").write_text(json.dumps(manifest, indent=1), encoding="utf-8")

tags = (
    f'<link rel="icon" type="image/png" href="{BASE}/favicon.png" />'
    f'<link rel="apple-touch-icon" href="{BASE}/apple-touch-icon.png" />'
    f'<link rel="manifest" href="{BASE}/app.webmanifest" />'
    '<meta name="apple-mobile-web-app-capable" content="yes" />'
    '<meta name="mobile-web-app-capable" content="yes" />'
    '<meta name="apple-mobile-web-app-title" content="HomeTower" />'
    '<meta name="apple-mobile-web-app-status-bar-style" content="default" />'
    '<meta name="theme-color" content="#0B2A4A" />'
)

index = DIST / "index.html"
html = index.read_text(encoding="utf-8")
if "apple-touch-icon" not in html:
    html = html.replace("</head>", tags + "</head>")
    index.write_text(html, encoding="utf-8")
print("fix_index: icons + webmanifest written, tags injected" if "apple-touch-icon" in html else "fix_index: FAILED")
