"""Maakt de standaard app-iconen (antraciet, gele route, witte finishvlag).

Gebruik: python3 tools/make-icons.py   (vereist Pillow)
Vervang later per evenement door het eigen vierkante logo.
"""
from pathlib import Path
from PIL import Image, ImageDraw

INK = (22, 24, 29, 255)
YELLOW = (242, 194, 48, 255)
WHITE = (255, 255, 255, 255)
OUT = Path(__file__).resolve().parent.parent / 'web' / 'public' / 'icons'
S = 1024  # tekenformaat; daarna verkleinen voor scherpe randen


def bezier(p0, p1, p2, p3, n=200):
    pts = []
    for i in range(n + 1):
        t = i / n
        x = (1-t)**3*p0[0] + 3*(1-t)**2*t*p1[0] + 3*(1-t)*t**2*p2[0] + t**3*p3[0]
        y = (1-t)**3*p0[1] + 3*(1-t)**2*t*p1[1] + 3*(1-t)*t**2*p2[1] + t**3*p3[1]
        pts.append((x, y))
    return pts


def draw_mark(d, scale, ox, oy, mono=None):
    """Route met startpunt en vlag, in een vak van 110x110 (zoals het ontwerp)."""
    def P(x, y):
        return (ox + x * scale, oy + y * scale)
    route = bezier(P(24, 82), P(24, 60), P(44, 62), P(52, 50)) + bezier(P(52, 50), P(60, 38), P(58, 30), P(80, 30))
    w = 7 * scale
    col = mono or YELLOW
    for a, b in zip(route, route[1:]):
        d.line([a, b], fill=col, width=int(w))
    for x, y in route[::4] + [route[-1]]:
        d.ellipse([x - w / 2, y - w / 2, x + w / 2, y + w / 2], fill=col)
    sx, sy = P(24, 84)
    r = 7 * scale
    d.ellipse([sx - r, sy - r, sx + r, sy + r], fill=col)
    flag = mono or WHITE
    d.line([P(80, 30), P(80, 16)], fill=flag, width=int(4 * scale))
    d.polygon([P(80, 16), P(94, 16), P(90, 21), P(94, 26), P(80, 26)], fill=flag)


def icon(full_bleed=True, safe=1.0):
    img = Image.new('RGBA', (S, S), INK if full_bleed else (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # Het teken beslaat het 110-vak; bij maskable krimpt het naar de veilige zone.
    scale = S / 110 * safe
    off = (S - 110 * scale) / 2
    draw_mark(d, scale, off, off)
    return img


def save(img, name, size):
    img.resize((size, size), Image.LANCZOS).save(OUT / name, optimize=True)


OUT.mkdir(parents=True, exist_ok=True)
base = icon()
save(base, 'icon-192.png', 192)
save(base, 'icon-512.png', 512)
save(base.convert('RGB'), 'apple-touch-icon.png', 180)
save(icon(safe=0.72), 'icon-maskable-512.png', 512)

# Kleine monochrome badge voor de Android-statusbalk (alleen de vorm telt).
badge = Image.new('RGBA', (S, S), (0, 0, 0, 0))
draw_mark(ImageDraw.Draw(badge), S / 110 * 0.95, S * 0.025, S * 0.025, mono=WHITE)
save(badge, 'badge-72.png', 72)
print('iconen gemaakt in', OUT)
