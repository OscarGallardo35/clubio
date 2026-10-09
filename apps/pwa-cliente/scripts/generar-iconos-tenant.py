#!/usr/bin/env python3
"""
Genera los iconos PNG de la PWA del cliente para un tenant, a partir de la marca
cuadrada/circular que subio el local.

Fuente esperada: `apps/pwa-cliente/public/icons/<slug>-logo.png`
Salida (mismos nombres que espera `lib/manifest-tenants.ts`):
  <slug>-icon-192.png           192x192  ("any")
  <slug>-icon-512.png           512x512  ("any")
  <slug>-icon-maskable-512.png  512x512  ("maskable", con ~20% de margen)
  <slug>-apple-touch-icon.png   180x180  (iOS)

Uso:  python apps/pwa-cliente/scripts/generar-iconos-tenant.py que-lomitos
Requiere Pillow (pip install Pillow).

Es de baja fidelidad si la fuente es chica: reemplazar <slug>-logo.png por una
imagen mas grande y volver a correrlo. Nada mas.
"""
import sys
from collections import Counter
from PIL import Image

RUTA_ICONOS = "apps/pwa-cliente/public/icons"


def color_fondo(im):
    """Color dominante del logo (el fondo rojo del badge), para rellenar el cuadrado."""
    c = Counter(im.convert("RGB").getdata())
    return c.most_common(1)[0][0]


def bbox_anillo(im):
    """Bounding box del anillo amarillo -> define el circulo a centrar."""
    W, H = im.size
    px = im.convert("RGB").load()
    minx, miny, maxx, maxy = W, H, -1, -1
    for y in range(H):
        for x in range(W):
            r, g, b = px[x, y]
            if r > 170 and g > 130 and b < 120:
                minx, maxx = min(minx, x), max(maxx, x)
                miny, maxy = min(miny, y), max(maxy, y)
    if maxx < 0:
        return (0, 0, W - 1, H - 1)
    return (minx, miny, maxx, maxy)


def cuadrado_centrado(im, fondo):
    """Recorta el cuadrado minimo que contiene el circulo, rellenando con `fondo`."""
    minx, miny, maxx, maxy = bbox_anillo(im)
    cx, cy = (minx + maxx) / 2, (miny + maxy) / 2
    lado = max(maxx - minx + 1, maxy - miny + 1) + 4  # +2px de aire por lado

    # Canvas con padding para poder centrar aunque el circulo toque un borde.
    pad = lado
    canvas = Image.new("RGB", (im.width + 2 * pad, im.height + 2 * pad), fondo)
    canvas.paste(im.convert("RGB"), (pad, pad))
    cx, cy = cx + pad, cy + pad
    izq, arr = int(round(cx - lado / 2)), int(round(cy - lado / 2))
    return canvas.crop((izq, arr, izq + lado, arr + lado))


def main():
    if len(sys.argv) != 2:
        sys.exit("uso: generar-iconos-tenant.py <slug>")
    slug = sys.argv[1]
    src = f"{RUTA_ICONOS}/{slug}-logo.png"
    im = Image.open(src)
    fondo = color_fondo(im)
    cuadrado = cuadrado_centrado(im, fondo)
    print(f"fuente {src} {im.size} -> cuadrado {cuadrado.size}, fondo #%02X%02X%02X" % fondo)

    cuadrado.resize((192, 192), Image.LANCZOS).save(f"{RUTA_ICONOS}/{slug}-icon-192.png", "PNG", optimize=True)
    cuadrado.resize((512, 512), Image.LANCZOS).save(f"{RUTA_ICONOS}/{slug}-icon-512.png", "PNG", optimize=True)
    cuadrado.resize((180, 180), Image.LANCZOS).save(f"{RUTA_ICONOS}/{slug}-apple-touch-icon.png", "PNG", optimize=True)

    # maskable: el circulo al ~80% del lado (20% de margen total), fondo del logo.
    lado_logo = int(512 * 0.8)  # 409
    canvas = Image.new("RGB", (512, 512), fondo)
    logo = cuadrado.resize((lado_logo, lado_logo), Image.LANCZOS)
    off = (512 - lado_logo) // 2
    canvas.paste(logo, (off, off))
    canvas.save(f"{RUTA_ICONOS}/{slug}-icon-maskable-512.png", "PNG", optimize=True)
    print("listo: 4 PNG generados en", RUTA_ICONOS)


if __name__ == "__main__":
    main()
