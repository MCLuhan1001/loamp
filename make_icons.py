#!/usr/bin/env python3
"""Erzeugt die LoAmp-Icons (SVG) und rendert sie per Headless-Chrome zu PNG."""
import pathlib
import subprocess
import tempfile

ROOT = pathlib.Path(__file__).parent / "icons"
ROOT.mkdir(exist_ok=True)
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

DEFS = """
<defs>
  <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#fff2c0"/><stop offset=".45" stop-color="#d9b765"/>
    <stop offset=".56" stop-color="#8f6f2a"/><stop offset="1" stop-color="#ecd48f"/>
  </linearGradient>
  <linearGradient id="chrome" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#fdfdfd"/><stop offset=".42" stop-color="#d9dde1"/>
    <stop offset=".5" stop-color="#9aa0a7"/><stop offset=".78" stop-color="#c4c8cd"/><stop offset="1" stop-color="#e9ecef"/>
  </linearGradient>
  <radialGradient id="face" cx=".5" cy=".95" r=".85">
    <stop offset="0" stop-color="#fff3c8"/><stop offset=".55" stop-color="#f0c96c"/><stop offset="1" stop-color="#a87a22"/>
  </radialGradient>
  <pattern id="dia" width="40" height="40" patternUnits="userSpaceOnUse">
    <path d="M0 0L40 40M40 0L0 40" stroke="#d9b765" stroke-opacity=".38" stroke-width="3.5"/>
  </pattern>
  <clipPath id="face-clip"><rect x="86" y="70" width="340" height="206" rx="22"/></clipPath>
</defs>"""


def content():
    # VU-Meter-Gesicht oben, Schriftzug unten
    import math
    cx, py, R = 256, 70 + 206 * 1.22, 206 * 0.98
    def pt(f, r):
        a = math.radians(-42 + 84 * f)
        return cx + math.sin(a) * r, py - math.cos(a) * r
    ticks = ""
    for i in range(0, 12):
        f = 0.07 + i * (0.93 / 11)
        x1, y1 = pt(f, R * .9); x2, y2 = pt(f, R * .97)
        col = "#c4281c" if f > .72 else "#2a1c08"
        ticks += f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" stroke="{col}" stroke-width="5"/>'
    nx, ny = pt(0.66, R * 1.03)
    return f"""
  <rect x="78" y="62" width="356" height="222" rx="28" fill="url(#chrome)"/>
  <rect x="86" y="70" width="340" height="206" rx="22" fill="url(#face)"/>
  <g clip-path="url(#face-clip)">
    {ticks}
    <text x="256" y="190" text-anchor="middle" font-family="Didot,'Bodoni 72',Georgia,serif" font-style="italic" font-weight="700" font-size="52" fill="#2a1c08" fill-opacity=".8">VU</text>
    <line x1="{cx}" y1="{py:.1f}" x2="{nx:.1f}" y2="{ny:.1f}" stroke="#17110a" stroke-width="4" stroke-linecap="round"/>
    <path d="M196 276a60 60 0 0 1 120 0z" fill="#16110b"/>
    <rect x="86" y="70" width="340" height="110" fill="#fff" fill-opacity=".14"/>
  </g>
  <text x="256" y="414" text-anchor="middle" font-family="'Snell Roundhand','Apple Chancery','Brush Script MT',cursive" font-weight="700" font-size="138" fill="url(#gold)" stroke="#000" stroke-opacity=".5" stroke-width="1.5">LoAmp</text>
"""


def svg(kind):
    body = content()
    if kind == "any":      # abgerundetes Quadrat mit Gitter und Biesen
        return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">{DEFS}
  <clipPath id="r"><rect width="512" height="512" rx="112"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="512" height="512" fill="#0d0c0b"/>
    <rect y="300" width="512" height="212" fill="#1b130d"/><rect y="300" width="512" height="212" fill="url(#dia)"/>
    <rect y="300" width="512" height="212" fill="#000" fill-opacity=".35"/>
    {body}
    <rect x="9" y="9" width="494" height="494" rx="104" fill="none" stroke="#e6dbbb" stroke-width="10"/>
  </g></svg>"""
    # maskable / apple: vollflächig, Inhalt in der Safe-Zone
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">{DEFS}
  <rect width="512" height="512" fill="#0d0c0b"/>
  <rect y="300" width="512" height="212" fill="#1b130d"/><rect y="300" width="512" height="212" fill="url(#dia)"/>
  <rect y="300" width="512" height="212" fill="#000" fill-opacity=".35"/>
  <g transform="translate(56.3 56.3) scale(.78)">{body}</g></svg>"""


def render(svg_text, size, out):
    with tempfile.TemporaryDirectory() as d:
        html = pathlib.Path(d, "i.html")
        sized = svg_text.replace("viewBox", 'width="%d" height="%d" viewBox' % (size, size), 1)
        html.write_text("<html><body style='margin:0;background:transparent'>" + sized + "</body></html>")
        subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars",
                        "--default-background-color=00000000", f"--window-size={size},{size}",
                        f"--screenshot={out}", f"file://{html}"], check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


if __name__ == "__main__":
    (ROOT / "icon.svg").write_text(svg("any"))
    render(svg("any"), 512, ROOT / "icon-512.png")
    render(svg("any"), 192, ROOT / "icon-192.png")
    render(svg("mask"), 512, ROOT / "icon-maskable-512.png")
    render(svg("mask"), 180, ROOT / "apple-touch-icon.png")
    print("Icons fertig:", sorted(p.name for p in ROOT.iterdir()))
