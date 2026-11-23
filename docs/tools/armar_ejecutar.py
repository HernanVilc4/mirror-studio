"""Arma «Mirror Studio - para ejecutar.docx» a partir de la plantilla de PushProMaster.

No crea un documento en blanco: abre la plantilla, sobrescribe el texto dentro de sus párrafos (conservando
el formato del primer run), clona párrafos o filas de la plantilla cuando hace falta otro igual y cambia las
dos capturas por las de Mirror Studio, en el mismo sitio y con el mismo ancho. Al final compara el formato
del resultado con el de la plantilla y se detiene con error si algo distinto del texto o las imágenes cambió.

Uso (desde la raíz del repositorio):
    python docs/tools/armar_ejecutar.py

Capturas que usa (capturas reales de la terminal; se pueden reemplazar y volver a ejecutar el script):
    docs/entregables/img/ejecutar-1-instalar.png     npm install + npm run build -w @mirror-studio/protocol
    docs/entregables/img/ejecutar-2-npm-run-dev.png  npm run dev

Necesita python-docx, lxml y pillow.
"""
import copy
import datetime
import difflib
import hashlib
import sys
import zipfile
from pathlib import Path

from docx import Document
from docx.oxml.ns import qn
from lxml import etree
from PIL import Image

RAIZ = Path(__file__).resolve().parents[2]
DOCS = RAIZ / 'docs'
PLANTILLA = next(DOCS.glob('pushpromaster - para para ejecutar_*.docx'))
SALIDA = DOCS / 'entregables' / 'Mirror Studio - para ejecutar.docx'
IMG_INSTALAR = DOCS / 'entregables' / 'img' / 'ejecutar-1-instalar.png'
IMG_DEV = DOCS / 'entregables' / 'img' / 'ejecutar-2-npm-run-dev.png'

URL_NODE = 'https://nodejs.org/'
URL_REPO = 'https://github.com/HernanVilc4/mirror-studio.git'
FIREWALL = ('netsh advfirewall firewall add rule name="Mirror Studio (dev)" dir=in action=allow '
            'program="$PWD\\node_modules\\electron\\dist\\electron.exe" enable=yes profile=private,domain')

R_ID = qn('r:id')
R_EMBED = qn('r:embed')
NS = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
      'wp': 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
      'a': 'http://schemas.openxmlformats.org/drawingml/2006/main',
      'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}


# ---------------------------------------------------------------- utilidades sobre el XML de la plantilla

def texto_de(el):
    return ''.join(t.text or '' for t in el.iter(qn('w:t')))


def poner_texto(run, texto):
    """Deja el run con su rPr y un único w:t con el texto nuevo."""
    for hijo in list(run):
        if hijo.tag != qn('w:rPr'):
            run.remove(hijo)
    t = etree.SubElement(run, qn('w:t'))
    t.text = texto
    t.set('{http://www.w3.org/XML/1998/namespace}space', 'preserve')


def dejar_solo(p, conservar):
    """Quita del párrafo todo lo que no sea su pPr o uno de los elementos indicados (runs sobrantes, proofErr...)."""
    for hijo in list(p):
        if hijo.tag != qn('w:pPr') and hijo not in conservar:
            p.remove(hijo)


def escribir(p, texto):
    """Sobrescribe el texto del párrafo en su primer run, con el formato de ese run."""
    run = p.find(qn('w:r'))
    dejar_solo(p, [run])
    poner_texto(run, texto)


def escribir_con_enlace(doc, p, antes, url, despues):
    """Párrafo «texto + hipervínculo + texto» de la plantilla: conserva sus tres piezas y cambia el destino."""
    enlace = p.find(qn('w:hyperlink'))
    hijos = list(p)
    i = hijos.index(enlace)
    r_antes = next(h for h in hijos[:i] if h.tag == qn('w:r'))
    r_despues = [h for h in hijos[i + 1:] if h.tag == qn('w:r')][-1]
    r_enlace = enlace.findall(qn('w:r'))
    for r in r_enlace[1:]:
        enlace.remove(r)
    for h in list(enlace):
        if h.tag != qn('w:r'):
            enlace.remove(h)
    dejar_solo(p, [r_antes, enlace, r_despues])
    poner_texto(r_antes, antes)
    poner_texto(r_enlace[0], url)
    poner_texto(r_despues, despues)
    doc.part.rels[enlace.get(R_ID)]._target = url


def clonar_despues(p, texto=None):
    nuevo = copy.deepcopy(p)
    p.addnext(nuevo)
    if texto is not None:
        escribir(nuevo, texto)
    return nuevo


def cambiar_imagen(doc, run, ruta):
    """Cambia la imagen del run por `ruta`, con el mismo ancho que tenía en la plantilla y su propia proporción."""
    blip = run.find('.//a:blip', NS)
    viejo = blip.get(R_EMBED)
    nuevo, _ = doc.part.get_or_add_image(str(ruta))
    blip.set(R_EMBED, nuevo)
    doc.part.drop_rel(viejo)
    ancho, alto = Image.open(ruta).size
    extent = run.find('.//wp:extent', NS)
    cx = int(extent.get('cx'))
    cy = round(cx * alto / ancho)
    extent.set('cy', str(cy))
    ext = run.find('.//a:xfrm/a:ext', NS)
    ext.set('cx', str(cx))
    ext.set('cy', str(cy))
    src = run.find('.//a:srcRect', NS)
    if src is not None:
        src.attrib.clear()


def quitar_restos_de_maquetacion(body):
    """lastRenderedPageBreak es solo una marca de dónde Word cortó la página la última vez; con texto nuevo ya no vale."""
    for el in list(body.iter(qn('w:lastRenderedPageBreak'))):
        el.getparent().remove(el)


# ---------------------------------------------------------------- contenido

def armar():
    for img in (IMG_INSTALAR, IMG_DEV):
        if not img.exists():
            sys.exit('Falta la captura %s' % img)
    doc = Document(str(PLANTILLA))
    body = doc.element.body
    P = [el for el in body if el.tag == qn('w:p')]
    tabla = body.find(qn('w:tbl'))

    # Comprueba que la plantilla es la esperada antes de tocarla.
    esperado = {0: 'Para para ejecutar', 1: 'Requisitos Previos', 6: 'Ejecución desde el código fuente',
                10: 'Descargar o clonar', 12: 'Instalar dependencias', 15: 'Ejecutar la aplicación',
                16: 'Ejecución desde archivo ejecutable', 17: 'Descargar el archivo .exe', 19: 'Ejecutar',
                22: 'Posibles advertencias'}
    for i, inicio in esperado.items():
        if not texto_de(P[i]).startswith(inicio):
            sys.exit('La plantilla no tiene la forma esperada en el párrafo %d: %r' % (i, texto_de(P[i])))

    escribir(P[0], 'Para para ejecutar “Mirror Studio”')

    # 1. Requisitos Previos
    escribir(P[2], 'Tener Windows 10 u 11 (Ubuntu también abre la aplicación, pero el control remoto solo '
                   'funciona en Windows).')
    escribir(P[3], 'Tener Git instalado (para descargar el proyecto, https://git-scm.com).')
    escribir(P[4], 'Tener Node.js 22 LTS o superior instalado (https://nodejs.org).')
    clonar_despues(P[4], 'Todas las PCs deben estar conectadas a la misma red local. La conexión a internet '
                         'solo se necesita para la instalación.')

    # 2. Ejecución desde el código fuente
    escribir(P[6], 'Ejecución desde el código fuente')
    escribir_con_enlace(doc, P[7], 'Instala Node.js, puedes hacerlo en ', URL_NODE,
                        '. Al momento de desarrollar el programa se usaron Node.js 22 y 24.')
    escribir(P[8], 'Asegúrate de dejar marcada la opción “Add to PATH” durante la instalación.')
    escribir_con_enlace(doc, P[11], 'Puedes clonar el repositorio con Git (git clone ', URL_REPO,
                        ') y luego entrar a la carpeta con cd mirror-studio. También puedes descargarlo como '
                        'ZIP desde GitHub (Code → Download ZIP) y descomprimirlo.')
    escribir(P[13], 'Abre una terminal o consola en la carpeta del proyecto y ejecuta: npm install y luego '
                    'npm run build -w @mirror-studio/protocol')
    cambiar_imagen(doc, P[14].xpath('.//w:r[w:drawing]')[0], IMG_INSTALAR)

    # 2.3: texto, salto de línea e imagen en el mismo párrafo, como en la plantilla.
    corrida_texto = P[15].find(qn('w:r'))
    corrida_salto = next(r for r in P[15].findall(qn('w:r')) if r.find(qn('w:br')) is not None)
    corrida_imagen = next(r for r in P[15].findall(qn('w:r')) if r.find(qn('w:drawing')) is not None)
    dejar_solo(P[15], [corrida_texto, corrida_salto, corrida_imagen])
    poner_texto(corrida_texto, 'Ejecutar la aplicación desde la terminal usando: npm run dev. Se abrirá la '
                               'ventana de Mirror Studio. También puedes abrir la carpeta del proyecto en Visual '
                               'Studio Code y ejecutar los mismos comandos en su terminal:')
    cambiar_imagen(doc, corrida_imagen, IMG_DEV)

    # 2.4: firewall, con un subpunto y una viñeta clonados de 2.2 (mismo formato).
    sub = copy.deepcopy(P[12])
    P[15].addnext(sub)
    escribir(sub, 'Permitir la aplicación en el firewall (solo en la PC anfitriona)')
    vineta = copy.deepcopy(P[13])
    sub.addnext(vineta)
    escribir(vineta, 'Una sola vez, abre PowerShell como administrador, entra a la carpeta del proyecto y '
                     'ejecuta: ' + FIREWALL)

    # 3. Ejecución desde archivo ejecutable (.exe)
    escribir(P[17], 'Generar el archivo .exe')
    escribir(P[18], 'En la carpeta del proyecto ejecuta npm run dist:portable. Se crea el archivo '
                    'release/Mirror-Studio-win32-x64.zip; descomprímelo donde quieras y dentro encontrarás '
                    'Mirror Studio.exe.')
    clonar_despues(P[18], 'Si prefieres un instalador, ejecuta npm run dist -w @mirror-studio/desktop. El '
                          'instalador queda como release/Mirror Studio Setup 0.1.0.exe.')
    # P[19] «Ejecutar», P[20] «Haz doble clic sobre el archivo .exe.» y P[21] (SmartScreen) ya sirven tal cual.

    # 3.2 Tabla de errores: filas 1 y 3 nuevas, fila 2 (SmartScreen) igual, y una fila más clonada de la 3.
    filas = tabla.findall(qn('w:tr'))

    def fila(tr, problema, solucion):
        c1, c2 = tr.findall(qn('w:tc'))
        escribir(c1.find(qn('w:p')), problema)
        escribir(c2.find(qn('w:p')), solucion)

    fila(filas[1], 'Node.js o npm no se reconoce como comando',
         'Instala Node.js 22 LTS o superior y abre una terminal nueva. Si sigue apareciendo, reinstálalo '
         'dejando marcada la opción “Add to PATH”.')
    fila(filas[3], 'La otra PC no ve la reunión o no puede entrar',
         'Crea la regla del firewall en la PC anfitriona (punto 2.4) y pon la red con el perfil Privada. Si la '
         'reunión no aparece en la lista, usa Unirse con IP y código.')
    extra = copy.deepcopy(filas[3])
    filas[3].addnext(extra)
    fila(extra, 'Aparece “El puerto 47800 ya está en uso”',
         'Hay otra ventana de Mirror Studio abierta en esa PC. Ciérrala (o cierra electron.exe en el '
         'Administrador de tareas) y vuelve a abrir la aplicación.')

    quitar_restos_de_maquetacion(body)

    cp = doc.core_properties
    cp.author = 'Mirror Studio'
    cp.last_modified_by = 'Mirror Studio'
    cp.modified = datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0, tzinfo=None)

    SALIDA.parent.mkdir(parents=True, exist_ok=True)
    doc.save(str(SALIDA))
    print('Creado:', SALIDA)


# ---------------------------------------------------------------- comprobación del formato

PARTES_FIJAS = ['word/styles.xml', 'word/numbering.xml', 'word/settings.xml', 'word/fontTable.xml',
                'word/theme/theme1.xml', 'word/webSettings.xml', 'word/footer1.xml']


def _canon(el):
    if el is None:
        return '-'
    el = copy.deepcopy(el)
    for x in el.iter():
        for k in list(x.attrib):
            if 'rsid' in k:
                del x.attrib[k]
    return etree.tostring(el, method='c14n').decode()


def _firma(ruta):
    z = zipfile.ZipFile(ruta)
    raiz = etree.fromstring(z.read('word/document.xml'))
    body = raiz.find('w:body', NS)
    pprs = [_canon(p.find('w:pPr', NS)) for p in body.iter(qn('w:p'))]
    rprs = {_canon(r.find('w:rPr', NS)) for r in body.iter(qn('w:r'))}
    tablas = []
    for t in body.iter(qn('w:tbl')):
        tablas.append((_canon(t.find('w:tblPr', NS)), _canon(t.find('w:tblGrid', NS)),
                       sorted({_canon(tc.find('w:tcPr', NS)) for tc in t.iter(qn('w:tc'))})))
    imagenes = [(e.get('cx'), e.get('cy')) for e in body.iter('{%s}extent' % NS['wp'])]
    medios = {hashlib.sha1(z.read(n)).hexdigest() for n in z.namelist() if n.startswith('word/media/')}
    partes = {}
    for n in PARTES_FIJAS:
        if n in z.namelist():
            partes[n] = etree.tostring(etree.fromstring(z.read(n)), method='c14n')
    rels = z.read('word/_rels/document.xml.rels').decode()
    return dict(sect=_canon(body.find('w:sectPr', NS)), pprs=pprs, rprs=rprs, tablas=tablas, imagenes=imagenes,
                medios=medios, partes=partes, texto=texto_de(body), rels=rels)


def comprobar(plantilla, salida, prohibido):
    a, b = _firma(plantilla), _firma(salida)
    fallos = []
    print('\nComparación de formato con la plantilla')
    print('  página y márgenes (sectPr) iguales:', a['sect'] == b['sect'])
    if a['sect'] != b['sect']:
        fallos.append('sectPr')
    for n in sorted(set(a['partes']) | set(b['partes'])):
        igual = a['partes'].get(n) == b['partes'].get(n)
        print('  %-22s igual: %s' % (n, igual))
        if not igual:
            fallos.append(n)
    nuevos_p = set(b['pprs']) - set(a['pprs'])
    nuevos_r = b['rprs'] - a['rprs']
    print('  formatos de párrafo: %d en la plantilla, %d en el resultado, nuevos: %d'
          % (len(set(a['pprs'])), len(set(b['pprs'])), len(nuevos_p)))
    print('  formatos de texto (runs): %d en la plantilla, %d en el resultado, nuevos: %d'
          % (len(a['rprs']), len(b['rprs']), len(nuevos_r)))
    if nuevos_p or nuevos_r:
        fallos.append('formatos nuevos')
    print('  tablas: misma tabla (tblPr, columnas, celdas):', a['tablas'] == b['tablas'])
    if a['tablas'] != b['tablas']:
        fallos.append('tabla')
    print('  imágenes: %d en la plantilla, %d en el resultado; anchos %s -> %s'
          % (len(a['imagenes']), len(b['imagenes']), [x[0] for x in a['imagenes']], [x[0] for x in b['imagenes']]))
    if len(a['imagenes']) != len(b['imagenes']) or [x[0] for x in a['imagenes']] != [x[0] for x in b['imagenes']]:
        fallos.append('imágenes')
    viejas = a['medios'] & b['medios']
    print('  capturas de la plantilla que siguen dentro:', len(viejas))
    if viejas:
        fallos.append('capturas viejas')
    restos = [x for x in prohibido if x.lower() in (b['texto'] + b['rels']).lower()]
    print('  restos de PushProMaster en texto o enlaces:', restos or 'ninguno')
    if restos:
        fallos.append('restos')
    # Orden de los párrafos: solo deben aparecer párrafos clonados de un vecino con el mismo formato.
    nombres = {}

    def corto(x):
        return nombres.setdefault(x, 'F%d' % len(nombres))
    sa = [corto(x) for x in a['pprs']]
    sb = [corto(x) for x in b['pprs']]
    cambios = [l for l in difflib.unified_diff(sa, sb, 'plantilla', 'resultado', n=0, lineterm='')
               if l[:1] in '+-' and not l.startswith(('+++', '---'))]
    print('  secuencia de formatos de párrafo, cambios (F = formato de párrafo de la plantilla):',
          ' '.join(cambios) or 'ninguno')
    if any(c.startswith('-') for c in cambios):
        fallos.append('párrafos con formato quitado')
    if fallos:
        sys.exit('El formato no coincide con la plantilla: ' + ', '.join(fallos))
    print('  => solo cambian textos, enlaces e imágenes.')


if __name__ == '__main__':
    armar()
    comprobar(PLANTILLA, SALIDA, ['PushProMaster', 'keinraf', 'python', 'pip install', 'Gitpython', '.py'])
