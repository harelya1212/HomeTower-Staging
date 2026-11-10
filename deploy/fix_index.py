#!/usr/bin/env python3
"""HomeTower post-export fix step for the Expo web build.

Run AFTER `npx expo export --platform web` and BEFORE pushing dist/ to
gh-pages. The Expo export emits an index.html with no iOS home-screen
tags at all (no apple-mobile-web-app-capable, no apple-touch-icon, no
manifest), so an installed home-screen app gets a generic icon and no
standalone web-app behavior. This step fixes that, mirroring the TReps
staging-deploy fix_index.py approach but with HomeTower values and
HomeTower's own icon asset:

  1. Injects the iOS / PWA tags into dist/index.html (idempotent).
  2. Generates apple-touch-icon.png (180x180), icon-192.png and
     icon-512.png from app/assets/icon.png into the dist root.
  3. Writes the web app manifest into the dist root as app.webmanifest.

HARD RULE (learned on TReps, binding): the manifest MUST ship as
app.webmanifest, NEVER as manifest.json. A manifest.json at the GitHub
Pages root breaks the Pages build; the same content named
*.webmanifest builds and serves fine.

Usage:
  python3 deploy/fix_index.py [dist_dir] [icon_source_png]

Defaults: dist_dir = <repo>/app/dist, icon = <repo>/app/assets/icon.png,
resolved relative to this script's location.
"""
import json
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
REPO_ROOT = HERE.parent

DIST = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else REPO_ROOT / "app" / "dist"
ICON_SRC = (
    pathlib.Path(sys.argv[2])
    if len(sys.argv) > 2
    else REPO_ROOT / "app" / "assets" / "icon.png"
)

APP_NAME = "HomeTower"
THEME_COLOR = "#0B2A4A"  # app.json splash backgroundColor / brand navy
BASE_PATH = "/HomeTower-Staging"  # app.json experiments.baseUrl

TAGS = (
    '<meta name="mobile-web-app-capable" content="yes" />'
    '<meta name="apple-mobile-web-app-capable" content="yes" />'
    f'<meta name="apple-mobile-web-app-title" content="{APP_NAME}" />'
    '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />'
    f'<meta name="theme-color" content="{THEME_COLOR}" />'
    '<link rel="apple-touch-icon" href="./apple-touch-icon.png" />'
    '<link rel="manifest" href="./app.webmanifest" />'
)

MANIFEST = {
    "name": APP_NAME,
    "short_name": APP_NAME,
    "start_url": f"{BASE_PATH}/",
    "scope": f"{BASE_PATH}/",
    "display": "standalone",
    "background_color": THEME_COLOR,
    "theme_color": THEME_COLOR,
    "icons": [
        {"src": f"{BASE_PATH}/icon-192.png", "sizes": "192x192", "type": "image/png"},
        {"src": f"{BASE_PATH}/icon-512.png", "sizes": "512x512", "type": "image/png"},
    ],
}

ICON_SIZES = {
    "apple-touch-icon.png": 180,
    "icon-192.png": 192,
    "icon-512.png": 512,
}


def fix_index(dist: pathlib.Path) -> str:
    index = dist / "index.html"
    html = index.read_text()
    if "apple-mobile-web-app-capable" not in html:
        if "</head>" not in html:
            raise SystemExit("index.html has no </head> to inject before")
        html = html.replace("</head>", TAGS + "</head>", 1)
        index.write_text(html)
    return html


def write_manifest(dist: pathlib.Path) -> None:
    # Named app.webmanifest on purpose; see the hard rule in the docstring.
    (dist / "app.webmanifest").write_text(json.dumps(MANIFEST, indent=1) + "\n")


def write_icons(dist: pathlib.Path, icon_src: pathlib.Path) -> None:
    from PIL import Image

    src = Image.open(icon_src).convert("RGB")
    for name, size in ICON_SIZES.items():
        src.resize((size, size), Image.LANCZOS).save(dist / name, "PNG")


def main() -> None:
    if not DIST.is_dir():
        raise SystemExit(f"dist dir not found: {DIST}")
    if not ICON_SRC.is_file():
        raise SystemExit(f"icon source not found: {ICON_SRC}")

    html = fix_index(DIST)
    write_manifest(DIST)
    write_icons(DIST, ICON_SRC)

    checks = {
        "capable": "apple-mobile-web-app-capable" in html,
        "status-bar-style": "apple-mobile-web-app-status-bar-style" in html,
        "theme-color": "theme-color" in html,
        "touch icon link": 'rel="apple-touch-icon"' in html,
        "manifest link": 'rel="manifest"' in html and "app.webmanifest" in html,
        "no manifest.json": not (DIST / "manifest.json").exists(),
        "files": all((DIST / n).is_file() for n in list(ICON_SIZES) + ["app.webmanifest"]),
    }
    for key, ok in checks.items():
        print(f"{key}: {ok}")
    if not all(checks.values()):
        raise SystemExit("fix_index verification FAILED")
    print(f"fix_index OK: {DIST}")


if __name__ == "__main__":
    main()
