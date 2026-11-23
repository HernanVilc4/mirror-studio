"""Arma «Mirror Studio - codigo fuente.docx» a partir de la plantilla de PushProMaster.

Abre la plantilla (no un documento en blanco), conserva el título «CÓDIGO FUENTE», el pie «pág. N» y la tabla,
cambia la imagen centrada por la ventana principal de Mirror Studio y llena la segunda fila de la tabla con el
código, una línea por párrafo, con el mismo formato que tenía el código en la plantilla (Consolas 9,5 pt, negro).
El código se lee del repositorio cada vez que se ejecuta el script, así que basta con volver a ejecutarlo
cuando el código cambie. Al final compara el formato con la plantilla y se detiene si algo no coincide.

Uso (desde la raíz del repositorio):
    python docs/tools/armar_codigo.py                    usa docs/manual/capturas/01-inicio.png
    python docs/tools/armar_codigo.py --imagen RUTA.png  usa otra captura de la ventana principal

Si no hay captura, pone una imagen marcada «CAPTURA PENDIENTE» en su lugar y lo avisa.
Necesita python-docx, lxml y pillow.
"""
import copy
import datetime
import difflib
import hashlib
import io
import re
import sys
import zipfile
from pathlib import Path

from docx import Document
from docx.oxml.ns import qn
from lxml import etree
from PIL import Image, ImageDraw, ImageFont

RAIZ = Path(__file__).resolve().parents[2]
DOCS = RAIZ / 'docs'
PLANTILLA = next(DOCS.glob('pushpromaster - codigo fuente_*.docx'))
SALIDA = DOCS / 'entregables' / 'Mirror Studio - codigo fuente.docx'
IMAGEN = DOCS / 'manual' / 'capturas' / '01-inicio.png'

# Orden de docs/GUIA-DOCUMENTACION.md, sección 3.
ARCHIVOS = [
    'packages/protocol/src/index.ts',
    'packages/protocol/src/node.ts',
    'apps/desktop/src/main/index.ts',
    'apps/desktop/src/main/meeting.ts',
    'apps/desktop/src/main/meeting-net.ts',
    'apps/desktop/src/main/network.ts',
    'apps/desktop/src/main/input.ts',
    'apps/desktop/src/preload/index.ts',
    'apps/desktop/src/renderer/src/controller.ts',
    'apps/desktop/src/renderer/src/media.ts',
    'apps/desktop/src/renderer/src/App.tsx',
]

R_EMBED = qn('r:embed')
XML_SPACE = '{http://www.w3.org/XML/1998/namespace}space'
NS = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
      'wp': 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
      'a': 'http://schemas.openxmlformats.org/drawingml/2006/main'}
NO_XML = re.compile('[\x00-\x08\x0b\x0c\x0e-\x1f￾￿]')


def texto_de(el):
    return ''.join(t.text or '' for t in el.iter(qn('w:t')))


def captura_pendiente():
    """Imagen gris claramente marcada, para que nadie la confunda con una captura real."""
    img = Image.new('RGB', (1600, 900), (235, 235, 235))
    d = ImageDraw.Draw(img)
    d.rectangle((8, 8, 1591, 891), outline=(200, 0, 0), width=8)
    try:
        grande = ImageFont.truetype('arial.ttf', 96)
        chica = ImageFont.truetype('arial.ttf', 40)
    except OSError:
        grande = chica = ImageFont.load_default()
    d.text((800, 380), 'CAPTURA PENDIENTE', fill=(200, 0, 0), font=grande, anchor='mm')
    d.text((800, 520), 'Ventana principal de Mirror Studio: docs/manual/capturas/01-inicio.png',
           fill=(60, 60, 60), font=chica, anchor='mm')
    d.text((800, 590), 'Luego volver a ejecutar docs/tools/armar_codigo.py', fill=(60, 60, 60), font=chica,
           anchor='mm')
    b = io.BytesIO()
    img.save(b, 'PNG')
    return b.getvalue()


def cambiar_imagen(doc, run, datos):
    """Cambia la imagen del run, con el mismo ancho que en la plantilla y la proporción de la captura nueva."""
    blip = run.find('.//a:blip', NS)
    viejo = blip.get(R_EMBED)
    nuevo, _ = doc.part.get_or_add_image(io.BytesIO(datos))
    blip.set(R_EMBED, nuevo)
    doc.part.drop_rel(viejo)
    ancho, alto = Image.open(io.BytesIO(datos)).size
    extent = run.find('.//wp:extent', NS)
    cx = int(extent.get('cx'))
    cy = round(cx * alto / ancho)
    extent.set('cy', str(cy))
    ext = run.find('.//a:xfrm/a:ext', NS)
    ext.set('cx', str(cx))
    ext.set('cy', str(cy))
    src = run.find('.//a:srcRect', NS)
    if src is not None:
        src.attrib.clear()  # el recorte era de la captura vieja


def leer_codigo(ruta):
    texto = (RAIZ / ruta).read_text(encoding='utf-8-sig')
    texto = NO_XML.sub('', texto.replace('\r\n', '\n').replace('\r', '\n'))
    return texto.rstrip('\n').split('\n')


def linea_de_codigo(p_modelo, rpr_modelo, linea):
    p = copy.deepcopy(p_modelo)
    if linea == '':
        return p  # en la plantilla las líneas en blanco son párrafos sin runs
    r = etree.SubElement(p, qn('w:r'))
    r.append(copy.deepcopy(rpr_modelo))
    for i, trozo in enumerate(linea.split('\t')):
        if i:
            etree.SubElement(r, qn('w:tab'))
        if trozo:
            t = etree.SubElement(r, qn('w:t'))
            t.text = trozo
            t.set(XML_SPACE, 'preserve')
    return p


def armar(ruta_imagen):
    doc = Document(str(PLANTILLA))
    body = doc.element.body
    P = [el for el in body if el.tag == qn('w:p')]
    if texto_de(P[0]) != 'CÓDIGO FUENTE' or P[3].find('.//w:drawing', NS) is None:
        sys.exit('La plantilla no tiene la forma esperada (título e imagen).')
    tabla = body.find(qn('w:tbl'))
    filas = tabla.findall(qn('w:tr'))
    if len(filas) != 2 or texto_de(filas[0]) != 'CÓDIGO FUENTE':
        sys.exit('La plantilla no tiene la forma esperada (tabla).')

    # Imagen centrada bajo el título.
    run_imagen = next(r for r in P[3].iter(qn('w:r')) if r.find(qn('w:drawing')) is not None)
    if ruta_imagen and Path(ruta_imagen).exists():
        datos = Path(ruta_imagen).read_bytes()
        aviso = None
    else:
        datos = captura_pendiente()
        aviso = 'AVISO: falta %s; se puso una imagen «CAPTURA PENDIENTE».' % ruta_imagen
    cambiar_imagen(doc, run_imagen, datos)

    # Código: la celda de la segunda fila se vacía y se llena con párrafos del mismo formato que la plantilla.
    celda = filas[1].find(qn('w:tc'))
    parrafos = celda.findall(qn('w:p'))
    p_modelo = copy.deepcopy(parrafos[0])
    rpr_modelo = copy.deepcopy(parrafos[0].find('.//w:r/w:rPr', NS))
    for hijo in list(p_modelo):
        if hijo.tag != qn('w:pPr'):
            p_modelo.remove(hijo)
    p_final = copy.deepcopy(parrafos[-1])  # párrafo vacío con el que termina la celda en la plantilla
    for p in parrafos:
        celda.remove(p)
    lineas = 0
    for n, ruta in enumerate(ARCHIVOS):
        if n:
            celda.append(linea_de_codigo(p_modelo, rpr_modelo, ''))
        celda.append(linea_de_codigo(p_modelo, rpr_modelo, '// ' + ruta))
        for linea in leer_codigo(ruta):
            celda.append(linea_de_codigo(p_modelo, rpr_modelo, linea))
            lineas += 1
    celda.append(p_final)

    for el in list(body.iter(qn('w:lastRenderedPageBreak'))):
        el.getparent().remove(el)

    cp = doc.core_properties
    cp.author = 'Mirror Studio'
    cp.last_modified_by = 'Mirror Studio'
    cp.modified = datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0, tzinfo=None)

    SALIDA.parent.mkdir(parents=True, exist_ok=True)
    doc.save(str(SALIDA))
    print('Creado:', SALIDA)
    print('  %d archivos, %d líneas de código' % (len(ARCHIVOS), lineas))
    print('  imagen:', ruta_imagen if not aviso else 'CAPTURA PENDIENTE')
    if aviso:
        print(aviso)


# ---------------------------------------------------------------- comprobación del formato

PARTES_FIJAS = ['word/styles.xml', 'word/numbering.xml', 'word/settings.xml', 'word/fontTable.xml',
                'word/theme/theme1.xml', 'word/webSettings.xml', 'word/footer1.xml', 'word/footnotes.xml',
                'word/endnotes.xml']


def _canon(el):
    if el is None:
        return '-'
    el = copy.deepcopy(el)
    for x in el.iter():
        for k in list(x.attrib):
            if 'rsid' in k:
                del x.attrib[k]
    return etree.tostring(el, method='c14n').decode()


def _en_celda_de_codigo(p):
    tr = next((a for a in p.iterancestors(qn('w:tr'))), None)
    return tr is not None and tr.getparent().index(tr) > tr.getparent().index(tr.getparent().find(qn('w:tr')))


def _firma(ruta):
    z = zipfile.ZipFile(ruta)
    raiz = etree.fromstring(z.read('word/document.xml'))
    body = raiz.find('w:body', NS)
    todos = list(body.iter(qn('w:p')))
    pprs = [_canon(p.find('w:pPr', NS)) for p in todos if not _en_celda_de_codigo(p)]
    pprs_codigo = {_canon(p.find('w:pPr', NS)) for p in todos if _en_celda_de_codigo(p)}
    rprs = {_canon(r.find('w:rPr', NS)) for r in body.iter(qn('w:r'))}
    tablas = []
    for t in body.iter(qn('w:tbl')):
        tablas.append((_canon(t.find('w:tblPr', NS)), _canon(t.find('w:tblGrid', NS)), len(t.findall(qn('w:tr'))),
                       sorted({_canon(tc.find('w:tcPr', NS)) for tc in t.iter(qn('w:tc'))})))
    imagenes = [(e.get('cx'), e.get('cy')) for e in body.iter('{%s}extent' % NS['wp'])]
    medios = {hashlib.sha1(z.read(n)).hexdigest() for n in z.namelist() if n.startswith('word/media/')}
    partes = {}
    for n in PARTES_FIJAS:
        if n in z.namelist():
            partes[n] = etree.tostring(etree.fromstring(z.read(n)), method='c14n')
    rels = z.read('word/_rels/document.xml.rels').decode()
    return dict(sect=_canon(body.find('w:sectPr', NS)), pprs=pprs, pprs_codigo=pprs_codigo, rprs=rprs,
                tablas=tablas, imagenes=imagenes, medios=medios, partes=partes, texto=texto_de(body), rels=rels)


def comprobar(plantilla, salida, prohibido):
    a, b = _firma(plantilla), _firma(salida)
    fallos = []
    print('\nComparación de formato con la plantilla')
    print('  página, márgenes y pie (sectPr) iguales:', a['sect'] == b['sect'])
    if a['sect'] != b['sect']:
        fallos.append('sectPr')
    for n in sorted(set(a['partes']) | set(b['partes'])):
        igual = a['partes'].get(n) == b['partes'].get(n)
        print('  %-22s igual: %s' % (n, igual))
        if not igual:
            fallos.append(n)
    nuevos_p = (set(b['pprs']) | b['pprs_codigo']) - (set(a['pprs']) | a['pprs_codigo'])
    nuevos_r = b['rprs'] - a['rprs']
    print('  formatos de párrafo nuevos: %d; formatos de texto (runs): %d en la plantilla, %d en el resultado, '
          'nuevos: %d' % (len(nuevos_p), len(a['rprs']), len(b['rprs']), len(nuevos_r)))
    print('  párrafos del código: %d formato(s), todos de la celda de código de la plantilla: %s'
          % (len(b['pprs_codigo']), b['pprs_codigo'] <= a['pprs_codigo']))
    if nuevos_p or nuevos_r or not b['pprs_codigo'] <= a['pprs_codigo']:
        fallos.append('formatos nuevos')
    print('  tabla (tblPr, columna, 2 filas, celdas) igual:', a['tablas'] == b['tablas'])
    if a['tablas'] != b['tablas']:
        fallos.append('tabla')
    print('  imágenes: %d en la plantilla, %d en el resultado; ancho %s -> %s'
          % (len(a['imagenes']), len(b['imagenes']), [x[0] for x in a['imagenes']], [x[0] for x in b['imagenes']]))
    if [x[0] for x in a['imagenes']] != [x[0] for x in b['imagenes']]:
        fallos.append('imágenes')
    viejas = a['medios'] & b['medios']
    print('  capturas de la plantilla que siguen dentro:', len(viejas))
    if viejas:
        fallos.append('capturas viejas')
    restos = [x for x in prohibido if x.lower() in (b['texto'] + b['rels']).lower()]
    print('  restos de PushProMaster:', restos or 'ninguno')
    if restos:
        fallos.append('restos')
    print('  párrafos fuera del código, misma secuencia de formatos que la plantilla:', a['pprs'] == b['pprs'])
    if a['pprs'] != b['pprs']:
        print('\n'.join(difflib.unified_diff(a['pprs'], b['pprs'], lineterm='')))
        fallos.append('párrafos')
    if fallos:
        sys.exit('El formato no coincide con la plantilla: ' + ', '.join(fallos))
    print('  => solo cambian el código y la imagen.')


if __name__ == '__main__':
    imagen = IMAGEN
    if '--imagen' in sys.argv:
        imagen = Path(sys.argv[sys.argv.index('--imagen') + 1])
    armar(imagen)
    comprobar(PLANTILLA, SALIDA, ['PushProMaster', 'keinraf', 'tkinter', 'GitPython', 'messagebox'])
