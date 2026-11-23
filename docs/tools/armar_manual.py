"""Arma «docs/entregables/Mirror Studio - manual de uso.docx» a partir de la plantilla de PushProMaster.

No crea un documento nuevo: abre la plantilla, sobrescribe el texto de sus párrafos (conservando el
formato de cada párrafo y de sus runs), quita las capturas viejas y pone las de Mirror Studio en su sitio.

    python docs/tools/armar_manual.py [--anotadas CARPETA] [--salida ARCHIVO.docx]

- Texto: docs/manual/textos.md (un bloque separado por línea en blanco = un párrafo; ver su cabecera).
- Capturas: docs/manual/anotadas/NN-*.png. Si falta alguna, deja el párrafo «[Captura NN pendiente]»
  y la lista al final. Se puede volver a ejecutar cuando lleguen las capturas: siempre parte de la plantilla.

Necesita python-docx, pillow y lxml.
"""
from __future__ import annotations

import argparse
import copy
import random
import re
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import docx
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
DOCS = ROOT / 'docs'
TEXTOS = DOCS / 'manual' / 'textos.md'
ANOTADAS = DOCS / 'manual' / 'anotadas'
SALIDA = DOCS / 'entregables' / 'Mirror Studio - manual de uso.docx'

EMU_PER_PX = 9525            # 96 ppp: el tamaño con el que Word pega una captura (así están las de la plantilla)
EMU_PER_TWIP = 635
MAX_ALTO = int(8.2 * 914400)  # la imagen más alta de la plantilla mide 8,22 pulgadas
W14 = 'http://schemas.microsoft.com/office/word/2010/wordml'


def plantilla() -> Path:
    found = sorted(DOCS.glob('pushpromaster - manual de uso_*.docx'))
    if not found:
        sys.exit('No encuentro la plantilla docs/pushpromaster - manual de uso_*.docx')
    return found[0]


# ---- textos.md -------------------------------------------------------------------------------------

@dataclass
class Bloque:
    kind: str                       # 'title' | 'h1' | 'text' | 'img'
    lines: list[str] = field(default_factory=list)
    nn: str = ''                    # captura (solo 'img')
    alt: str = ''                   # captura de reserva, p. ej. «27 | 10»
    ruta: Path | None = None        # archivo de la captura; None = pendiente


CAPTURA = re.compile(r'^\[captura\s+(\d{2})[^\]|]*(?:\|\s*(\d{2})[^\]]*)?\]$')


def inline(s: str) -> str:
    """**Botón** -> “Botón”: la plantilla cita los botones entre comillas, sin negrita."""
    s = re.sub(r'\*\*(.+?)\*\*', '“\\1”', s)
    s = s.replace('`', '')
    if re.search(r'[*#`|]', s):
        sys.exit(f'Queda una marca de Markdown en el texto: {s!r}')
    return s


def leer_textos() -> list[Bloque]:
    raw = re.sub(r'<!--.*?-->', '', TEXTOS.read_text(encoding='utf-8'), flags=re.S)
    out: list[Bloque] = []
    for chunk in re.split(r'\n\s*\n', raw.strip()):
        lines = [ln.rstrip() for ln in chunk.strip('\n').split('\n') if ln.strip()]
        if not lines:
            continue
        first = lines[0].strip()
        if first.startswith('# '):
            out.append(Bloque('title', [inline(first[2:].strip())]))
        elif first.startswith('## '):
            out.append(Bloque('h1', [inline(first[3:].strip())]))
        elif m := CAPTURA.match(first):
            out.append(Bloque('img', [inline(x) for x in lines[1:]], nn=m.group(1), alt=m.group(2) or ''))
        else:
            out.append(Bloque('text', [inline(x) for x in lines]))
    return out


def archivo_captura(nn: str) -> Path | None:
    found = sorted(ANOTADAS.glob(f'{nn}-*.png')) if ANOTADAS.is_dir() else []
    return found[0] if found else None


# ---- párrafos de la plantilla ------------------------------------------------------------------------

def tiene_imagen(p) -> bool:
    return p.find('.//' + qn('w:drawing')) is not None


def texto(p) -> str:
    return ''.join(t.text or '' for t in p.iter(qn('w:t')))


def nuevo_para_id(usados: set[str]) -> str:
    while True:
        v = '%08X' % random.randint(0x10000000, 0x7FFFFFFF)
        if v not in usados:
            usados.add(v)
            return v


def run_modelo(p):
    """Copia vacía del primer run del párrafo: conserva sus atributos y su rPr (formato del texto)."""
    r = p.find(qn('w:r'))
    if r is None:
        r = OxmlElement('w:r')
    r = copy.deepcopy(r)
    for child in list(r):
        if child.tag != qn('w:rPr'):
            r.remove(child)
    return r


def vaciar(p):
    """Quita runs, marcas de ortografía, etc. Deja solo el formato del párrafo (pPr)."""
    modelo = run_modelo(p)
    for child in list(p):
        if child.tag != qn('w:pPr'):
            p.remove(child)
    return modelo


def escribir_lineas(p, modelo, lines: list[str], salto_inicial: bool = False):
    """Como la plantilla: cada línea en su run, y las siguientes empiezan con un salto de línea (w:br)."""
    for k, line in enumerate(lines):
        r = copy.deepcopy(modelo)
        if k > 0 or salto_inicial:
            r.append(OxmlElement('w:br'))
        t = OxmlElement('w:t')
        t.text = line
        t.set('{http://www.w3.org/XML/1998/namespace}space', 'preserve')
        r.append(t)
        p.append(r)


def sangria_emu(p) -> int:
    ind = p.find(qn('w:pPr') + '/' + qn('w:ind'))
    if ind is None:
        return 0
    left = int(ind.get(qn('w:left')) or ind.get(qn('w:start')) or 0)
    first = int(ind.get(qn('w:firstLine')) or 0)
    return (left + first) * EMU_PER_TWIP


def poner_imagen(doc, p, modelo, ruta: Path, ancho_texto: int):
    with Image.open(ruta) as im:
        w_px, h_px = im.size
    ancho = min(w_px * EMU_PER_PX, ancho_texto - sangria_emu(p))
    alto = round(ancho * h_px / w_px)
    if alto > MAX_ALTO:
        alto = MAX_ALTO
        ancho = round(alto * w_px / h_px)
    inline_el = doc.part.new_pic_inline(str(ruta), ancho, alto)
    r = copy.deepcopy(modelo)
    r.add_drawing(inline_el)
    p.append(r)


# ---- armado -----------------------------------------------------------------------------------------

def main():
    global ANOTADAS, SALIDA
    ap = argparse.ArgumentParser(description='Arma el Manual de Uso de Mirror Studio desde la plantilla.')
    ap.add_argument('--anotadas', type=Path, default=ANOTADAS, help='carpeta con las capturas NN-*.png')
    ap.add_argument('--salida', type=Path, default=SALIDA, help='archivo .docx que se genera')
    args = ap.parse_args()
    ANOTADAS, SALIDA = args.anotadas.resolve(), args.salida.resolve()

    tpl = plantilla()
    doc = docx.Document(str(tpl))
    body = doc.element.body
    sec = doc.sections[0]
    ancho_texto = sec.page_width - sec.left_margin - sec.right_margin

    bloques = leer_textos()
    pendientes: list[str] = []
    reemplazos: list[str] = []
    for b in bloques:
        if b.kind != 'img':
            continue
        ruta = archivo_captura(b.nn)
        if ruta is None and b.alt:
            ruta = archivo_captura(b.alt)
            if ruta is not None:
                reemplazos.append(f'{b.nn} -> se usa la {b.alt}')
            else:
                b.nn = b.alt
        if ruta is None and b.nn not in pendientes:
            pendientes.append(b.nn)
        b.ruta = ruta

    # La plantilla: título, y cada «Título 1» seguido de sus párrafos.
    paras = [el for el in body if el.tag == qn('w:p')]
    titulo_el = paras[0]
    secciones_tpl: list[tuple] = []  # (heading, [párrafos del cuerpo])
    for el in paras[1:]:
        estilo = el.find(qn('w:pPr') + '/' + qn('w:pStyle'))
        if estilo is not None and estilo.get(qn('w:val')) == 'Ttulo1':
            secciones_tpl.append((el, []))
        else:
            secciones_tpl[-1][1].append(el)

    # Los textos: título y secciones.
    if bloques[0].kind != 'title':
        sys.exit('textos.md debe empezar con «# Título»')
    secciones_txt: list[tuple] = []
    for b in bloques[1:]:
        if b.kind == 'h1':
            secciones_txt.append((b, []))
        elif b.kind == 'title':
            sys.exit('Solo puede haber un título «# » en textos.md')
        else:
            secciones_txt[-1][1].append(b)
    if len(secciones_txt) != len(secciones_tpl):
        sys.exit(f'textos.md tiene {len(secciones_txt)} secciones y la plantilla {len(secciones_tpl)}')

    usados = {el.get(f'{{{W14}}}paraId') for el in body.iter(qn('w:p'))} - {None}

    def clonar(proto):
        el = copy.deepcopy(proto)
        if el.get(f'{{{W14}}}paraId') is not None:
            el.set(f'{{{W14}}}paraId', nuevo_para_id(usados))
        return el

    # Título
    modelo = vaciar(titulo_el)
    escribir_lineas(titulo_el, modelo, bloques[0].lines)

    for (h_el, pool_tpl), (h_txt, items) in zip(secciones_tpl, secciones_txt):
        if texto(h_el).strip() != h_txt.lines[0]:
            print(f'Aviso: la sección «{h_txt.lines[0]}» se llama «{texto(h_el)}» en la plantilla', file=sys.stderr)
        modelo = vaciar(h_el)
        escribir_lineas(h_el, modelo, h_txt.lines)

        # Cada bloque reutiliza el siguiente párrafo de la plantilla de su mismo tipo (texto o imagen),
        # en orden; si se acaban, se copia el último usado de ese tipo. Los que sobran se borran.
        pool = [(el, 'img' if tiene_imagen(el) else 'text') for el in pool_tpl]
        primero = {k: next((el for el, kk in pool if kk == k), None) for k in ('text', 'img')}
        ultimo: dict[str, object] = {}
        i = 0
        salida = []
        for b in items:
            kind = 'img' if b.kind == 'img' else 'text'
            j = i
            while j < len(pool) and pool[j][1] != kind:
                j += 1
            if j < len(pool):
                el = pool[j][0]
                i = j + 1
            else:
                candidatos = (ultimo.get(kind), primero[kind], ultimo.get('text'), primero['text'], pool_tpl[-1])
                el = clonar(next(c for c in candidatos if c is not None))
            ultimo[kind] = el
            salida.append((el, b))

        for el in pool_tpl:
            body.remove(el)
        orden = []
        for el, b in salida:
            if b.kind == 'img' and b.ruta is None and b.lines:
                # Captura pendiente con texto debajo (sección 4): el aviso y el texto van en párrafos aparte.
                otro = clonar(el)
                escribir_lineas(otro, vaciar(otro), b.lines)
                modelo = vaciar(el)
                escribir_lineas(el, modelo, [f'[Captura {b.nn} pendiente]'])
                orden += [el, otro]
                continue
            modelo = vaciar(el)
            if b.kind == 'text':
                escribir_lineas(el, modelo, b.lines)
            elif b.ruta is None:
                escribir_lineas(el, modelo, [f'[Captura {b.nn} pendiente]'])
            else:
                poner_imagen(doc, el, modelo, b.ruta, ancho_texto)
                escribir_lineas(el, modelo, b.lines, salto_inicial=True)
            orden.append(el)
        ancla = h_el
        for el in orden:
            ancla.addnext(el)
            ancla = el

    # Fuera las capturas de PushProMaster: relaciones de imagen que ya nadie usa.
    vivos = set(body.xpath('.//@r:embed | .//@r:id | .//@r:link'))
    for rid, rel in list(doc.part.rels.items()):
        if rel.reltype.endswith('/image') and rid not in vivos:
            doc.part.rels.pop(rid)

    cp = doc.core_properties
    cp.last_modified_by = ''
    cp.modified = datetime.now(timezone.utc).replace(microsecond=0, tzinfo=None)

    SALIDA.parent.mkdir(parents=True, exist_ok=True)
    doc.save(str(SALIDA))

    n_img = len(body.findall('.//' + qn('w:drawing')))
    print(f'Listo: {SALIDA} ({n_img} capturas puestas)')
    for r in reemplazos:
        print(f'Captura {r}')
    if pendientes:
        print(f'Capturas pendientes ({len(pendientes)}): ' + ', '.join(sorted(pendientes)))
        print(f'Ponlas en {ANOTADAS} como NN-nombre.png y vuelve a ejecutar este script.')
    else:
        print('No falta ninguna captura.')


if __name__ == '__main__':
    main()
