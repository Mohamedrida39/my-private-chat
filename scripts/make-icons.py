"""يولّد أيقونات PWA (آلة حاسبة وهمية) وأيقونة الجرس للإشعارات. الاستعمال: python3 scripts/make-icons.py"""
import os
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(__file__), "..", "public", "icons")
os.makedirs(OUT, exist_ok=True)
S = 1024  # نرسم بدقة عالية ثم نصغّر


def calculator(pad=0.0):
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    full = pad > 0
    if full:
        d.rectangle([0, 0, S, S], fill="#1c1c1e")
    else:
        d.rounded_rectangle([0, 0, S, S], radius=int(S * 0.22), fill="#1c1c1e")
    m = int(S * (0.14 + pad))
    inner = S - 2 * m
    # شاشة
    d.rounded_rectangle([m, m, S - m, m + inner * 0.26], radius=int(inner * 0.05), fill="#2c2c2e")
    d.text((S - m - inner * 0.08, m + inner * 0.03), "", fill="white")
    # أزرار 4x4
    top = m + inner * 0.32
    gap = inner * 0.04
    bw = (inner - 3 * gap) / 4
    bh = (inner * 0.68 - 3 * gap) / 4
    for r in range(4):
        for c in range(4):
            x = m + c * (bw + gap)
            y = top + r * (bh + gap)
            color = "#ff9f0a" if c == 3 else ("#636366" if r == 0 else "#3a3a3c")
            d.rounded_rectangle([x, y, x + bw, y + bh], radius=int(bw * 0.28), fill=color)
    return img


def bell(size_px, bg=True, mono=False):
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if bg and not mono:
        d.ellipse([0, 0, S, S], fill="#1c1c1e")
    fg = "white" if mono else "#ffd60a"
    c = S / 2
    # قبة الجرس
    d.ellipse([c - 250, 220, c + 250, 720], fill=fg)
    # جسم الجرس
    d.polygon([(c - 250, 470), (c + 250, 470), (c + 340, 740), (c - 340, 740)], fill=fg)
    # الحافة السفلية
    d.rounded_rectangle([c - 380, 710, c + 380, 790], radius=40, fill=fg)
    # المقبض العلوي
    d.ellipse([c - 45, 150, c + 45, 240], fill=fg)
    # اللسان
    d.ellipse([c - 70, 780, c + 70, 920], fill=fg)
    return img


def save(img, name, px):
    img.resize((px, px), Image.LANCZOS).save(os.path.join(OUT, name))


calc = calculator()
save(calc, "icon-512.png", 512)
save(calc, "icon-192.png", 192)
save(calc, "icon-180.png", 180)
save(calculator(pad=0.08), "icon-maskable-512.png", 512)
save(bell(1, bg=True), "bell-192.png", 192)
save(bell(1, bg=False, mono=True), "badge-96.png", 96)
print("icons written to", os.path.abspath(OUT))
