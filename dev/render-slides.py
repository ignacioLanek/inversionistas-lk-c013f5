#!/usr/bin/env python3
"""Convierte las diapositivas de un deck de Claude Design (Slides) en imágenes JPG 1920×1080 + notas.

Uso:  python3 dev/render-slides.py <seccion> [<seccion> ...]

Espera, por sección, la carpeta dev/deck-work/<seccion>/ (ignorada por git, contenido confidencial) con:
  project/deck.json, project/slides/<id>.html   (leídos del artefacto)
  blob/<id>.<ext>                               (imágenes /_blob/<id> del artefacto)
Genera dev/deck-work/out/<seccion>-NN.jpg y dev/deck-work/out/<seccion>.json (orden, imagen, notas)
listo para subir a la carpeta "02 Deck sitio web" y a la pestaña "diapositivas" de la hoja.
"""
import glob, html, json, os, re, subprocess, sys, tempfile

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "deck-work")
OUT = os.path.join(ROOT, "out")
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
BASE = """* { margin: 0 }
html, body { width:1920px; height:1080px; overflow:hidden; background:#fff }
body { font: 32px/1.2 sans-serif; font-family: Jost, Arial, sans-serif; color: #111 }
body > section { width: 1920px !important; height: 1080px !important; overflow: hidden !important; box-sizing: border-box !important; position: relative; isolation: isolate; background: #fff }
section[hidden], aside, noscript { display: none !important }
h1 { font-size: 96px; font-weight: 600 } h2 { font-size: 64px; font-weight: 600 } h3 { font-size: 44px; font-weight: 600 }
p, li, h1, h2, h3, td, th { overflow-wrap: break-word; text-wrap: pretty }
a { color: #377af0; text-decoration: none }
"""
FONTS = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Jost:wght@300;400;500;600&family=IBM+Plex+Mono:wght@400;500&display=block">'


def render(sec):
    root = os.path.join(ROOT, sec)
    deck = json.load(open(os.path.join(root, "project/deck.json"), encoding="utf-8"))
    blobs = {os.path.splitext(os.path.basename(p))[0]: os.path.basename(p) for p in glob.glob(os.path.join(root, "blob/*"))}
    rows = []
    for i, sid in enumerate(deck["order"], 1):
        src = open(os.path.join(root, "project/slides", sid + ".html"), encoding="utf-8").read()
        m = re.search(r"<aside>(.*?)</aside>", src, re.S)
        notas = "\n".join(l.strip() for l in html.unescape(re.sub(r"<[^>]+>", "", m.group(1))).splitlines() if l.strip()) if m else ""
        faltan = sorted(set(re.findall(r"/_blob/([0-9a-f]{32})", src)) - set(blobs))
        if faltan:
            sys.exit(f"[{sec}] faltan imágenes en blob/: {', '.join(faltan)}")
        body = re.sub(r"/_blob/([0-9a-f]{32})", lambda mm: "blob/" + blobs[mm.group(1)], src)
        body = re.sub(r'data-crop="[\d.]+ ([\d.]+%) ([\d.]+%)"([^>]*?)style="', r'\3style="object-position:\1 \2; ', body)
        name = f"{sec}-{i:02d}"
        page = os.path.join(root, name + ".html")
        open(page, "w", encoding="utf-8").write(f"<!doctype html><html><head><meta charset='utf-8'>{FONTS}<style>{BASE}</style></head><body>{body}</body></html>")
        png = os.path.join(OUT, name + ".png")
        with tempfile.TemporaryDirectory() as prof:
            subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", f"--user-data-dir={prof}",
                            "--window-size=1920,1080", "--virtual-time-budget=10000", f"--screenshot={png}", "file://" + page],
                           stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
        jpg = os.path.join(OUT, name + ".jpg")
        subprocess.run(["sips", "-s", "format", "jpeg", "-s", "formatOptions", "85", png, "--out", jpg], stdout=subprocess.DEVNULL, check=True)
        os.remove(png)
        rows.append({"seccion": sec, "orden": i, "imagen": name + ".jpg", "notas": notas, "slide": sid})
        print(f"{name}.jpg  ({os.path.getsize(jpg)//1024} KB)  ← {sid}")
    json.dump(rows, open(os.path.join(OUT, sec + ".json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    os.makedirs(OUT, exist_ok=True)
    for s in sys.argv[1:]:
        render(s)
