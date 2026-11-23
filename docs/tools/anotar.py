"""Marca capturas del manual con el mismo estilo en todas: circulos y bordes punteados rojos, numerados.

Uso:
  pip install pillow
  python docs/tools/anotar.py entrada.png salida.png circulo:620,470,60:1 rect:300,330,620,500:2
    circulo:X,Y,RADIO:N        circulo alrededor de un boton pequeno o un icono (N = numero del paso)
    ovalo:X1,Y1,X2,Y2:N        ovalo alrededor de un boton ancho (la caja del boton)
    rect:X1,Y1,X2,Y2:N         borde punteado alrededor de una zona (tarjeta, panel, lista)
  python docs/tools/anotar.py --test   comprueba que funciona

Las coordenadas son pixeles de la captura (las mismas que da computer use / la imagen).
"""
import sys
from PIL import Image, ImageDraw, ImageFont, ImageOps

ROJO = (229, 57, 53)
GROSOR = 4
TRAZO, HUECO = 14, 9


def _punteado(d, a, b):
    (x1, y1), (x2, y2) = a, b
    largo = max(abs(x2 - x1), abs(y2 - y1))
    paso = 0
    while paso < largo:
        f1, f2 = paso / largo, min(paso + TRAZO, largo) / largo
        d.line([(x1 + (x2 - x1) * f1, y1 + (y2 - y1) * f1), (x1 + (x2 - x1) * f2, y1 + (y2 - y1) * f2)], fill=ROJO, width=GROSOR)
        paso += TRAZO + HUECO


def _numero(d, x, y, n, size=None):
    r = 15
    if size is not None:
        w, h = size
        x = max(r + 1, min(x, w - r - 1))
        # Los selectores de tema están pegados al borde superior. Pon su
        # número debajo del control para no cortarlo ni tapar su etiqueta.
        if y < r + 1:
            y = 50
        y = max(r + 1, min(y, h - r - 1))
    d.ellipse([x - r, y - r, x + r, y + r], fill=ROJO)
    try:
        fuente = ImageFont.truetype('arialbd.ttf', 18)
    except OSError:
        fuente = ImageFont.load_default()
    d.text((x, y), str(n), fill='white', font=fuente, anchor='mm')


def anotar(entrada, salida, marcas, margen=0):
    img = Image.open(entrada).convert('RGB')
    if margen:
        img = ImageOps.expand(img, border=margen, fill='white')
    d = ImageDraw.Draw(img)
    for m in marcas:
        tipo, coords, n = m.split(':')
        v = [int(float(c)) for c in coords.split(',')]
        if tipo == 'circulo':
            x, y, r = v
            d.ellipse([x - r, y - r, x + r, y + r], outline=ROJO, width=GROSOR)
            _numero(d, x + int(r * 0.72), y - int(r * 0.72), n, img.size)
        elif tipo == 'ovalo':
            x1, y1, x2, y2 = v
            px, py = 18, max(16, (y2 - y1) // 2)  # margen para que el ovalo rodee el boton sin cortar sus esquinas
            d.ellipse([x1 - px, y1 - py, x2 + px, y2 + py], outline=ROJO, width=GROSOR)
            _numero(d, x2 + px - 10, y1 - py + 8, n, img.size)
        elif tipo == 'rect':
            x1, y1, x2, y2 = v
            for a, b in [((x1, y1), (x2, y1)), ((x2, y1), (x2, y2)), ((x2, y2), (x1, y2)), ((x1, y2), (x1, y1))]:
                _punteado(d, a, b)
            _numero(d, x1, y1, n, img.size)
        else:
            raise SystemExit(f'Marca desconocida: {m} (usa circulo:... o rect:...)')
    img.save(salida)


if __name__ == '__main__':
    if sys.argv[1:] == ['--test']:
        import os, tempfile
        t = tempfile.mkdtemp()
        Image.new('RGB', (400, 300), 'black').save(os.path.join(t, 'a.png'))
        anotar(os.path.join(t, 'a.png'), os.path.join(t, 'b.png'), ['circulo:100,100,40:1', 'rect:200,150,380,280:2'])
        out = Image.open(os.path.join(t, 'b.png'))
        assert out.size == (400, 300) and out.getpixel((100, 60)) == ROJO, 'no se dibujo la marca'
        print('ok')
    elif len(sys.argv) >= 4:
        marcas = sys.argv[3:]
        margen = 0
        if marcas and marcas[0].startswith('--margen='):
            margen = int(marcas.pop(0).split('=', 1)[1])
        anotar(sys.argv[1], sys.argv[2], marcas, margen)
    else:
        print(__doc__)
