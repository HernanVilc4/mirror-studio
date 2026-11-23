"""Arma «Mirror Studio - para ejecutar.docx» a partir de la plantilla de PushProMaster.

Es una guía paso a paso para personas sin experiencia técnica: instalar Git y Node.js, descargar el proyecto,
ejecutarlo, o bajar directamente el ejecutable. Cada paso lleva su captura real.

No crea un documento en blanco: abre la plantilla, sobrescribe el texto dentro de sus párrafos (conservando
el formato del primer run), clona párrafos o filas de la plantilla cuando hace falta otro igual (subpuntos,
viñetas y párrafos de imagen) y pone las capturas con el ancho de las de la plantilla. Al final compara el
formato del resultado con el de la plantilla y se detiene con error si algo distinto del texto, el número de
imágenes o las propias imágenes cambió.

Uso (desde la raíz del repositorio):
    python docs/tools/armar_ejecutar.py

Capturas que usa (todas reales; se pueden reemplazar y volver a ejecutar el script):
    docs/entregables/img/ejecutar-web-*.png           páginas de descarga, tomadas con Chrome (perfil limpio)
                                                      y marcadas con docs/tools/anotar.py; sin marcar en img/originales/
    docs/entregables/img/ejecutar-term-*.png          PowerShell: versiones instaladas y git clone
    docs/entregables/img/ejecutar-1-instalar.png      npm install + npm run build -w @mirror-studio/protocol
    docs/entregables/img/ejecutar-2-npm-run-dev.png   npm run dev
    docs/manual/capturas/01-inicio.png, docs/manual/anotadas/26-ayuda-red.png  (del manual)

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
IMG = DOCS / 'entregables' / 'img'
IMG_INSTALAR = IMG / 'ejecutar-1-instalar.png'
IMG_DEV = IMG / 'ejecutar-2-npm-run-dev.png'
IMG_GIT = IMG / 'ejecutar-web-git.png'
IMG_NODE = IMG / 'ejecutar-web-node.png'
IMG_VERSIONES = IMG / 'ejecutar-term-versiones.png'
IMG_CLONAR = IMG / 'ejecutar-term-clonar.png'
IMG_GITHUB = IMG / 'ejecutar-web-github-code.png'
IMG_RELEASE = IMG / 'ejecutar-web-release.png'
IMG_INICIO = DOCS / 'manual' / 'capturas' / '01-inicio.png'
IMG_AYUDA = DOCS / 'manual' / 'anotadas' / '26-ayuda-red.png'
TODAS = [IMG_INSTALAR, IMG_DEV, IMG_GIT, IMG_NODE, IMG_VERSIONES, IMG_CLONAR, IMG_GITHUB, IMG_RELEASE, IMG_INICIO, IMG_AYUDA]

URL_NODE = 'https://nodejs.org/es/download'
URL_RELEASE = 'https://github.com/HernanVilc4/mirror-studio/releases/tag/v0.1.0'
URL_REPO = 'https://github.com/HernanVilc4/mirror-studio.git'

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
    nuevo, _ = doc.part.get_or_add_image(str(ruta))
    blip.set(R_EMBED, nuevo)
    # La imagen vieja no se suelta aquí: la comparten los párrafos clonados. Ver quitar_imagenes_sin_uso().
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


def imagen_despues(doc, modelo, despues_de, ruta):
    """Párrafo de solo imagen clonado del de la plantilla (mismo formato y ancho), con la captura `ruta`."""
    nuevo = copy.deepcopy(modelo)
    despues_de.addnext(nuevo)
    cambiar_imagen(doc, nuevo.xpath('.//w:r[w:drawing]')[0], ruta)
    return nuevo


def quitar_imagenes_sin_uso(doc):
    """Suelta las imágenes que ya no usa ningún párrafo (las capturas de la plantilla)."""
    usadas = {b.get(R_EMBED) for b in doc.element.body.iter('{%s}blip' % NS['a'])}
    for rid, rel in list(doc.part.rels.items()):
        if rel.reltype.endswith('/image') and rid not in usadas:
            del doc.part.rels[rid]


def numerar_dibujos(body):
    """Cada imagen necesita su propio id de dibujo; los párrafos clonados lo repetían."""
    for i, pr in enumerate(body.iter('{%s}docPr' % NS['wp']), start=1):
        pr.set('id', str(i))


def quitar_restos_de_maquetacion(body):
    """lastRenderedPageBreak es solo una marca de dónde Word cortó la página la última vez; con texto nuevo ya no vale."""
    for el in list(body.iter(qn('w:lastRenderedPageBreak'))):
        el.getparent().remove(el)


# ---------------------------------------------------------------- contenido

def armar():
    for img in TODAS:
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
    modelo_sub = copy.deepcopy(P[10])        # subpunto (2.x) de la lista numerada
    modelo_vineta = copy.deepcopy(P[11])     # viñeta bajo un subpunto
    modelo_imagen = copy.deepcopy(P[14])     # párrafo de solo imagen

    def sub(antes_de, texto):
        nuevo = copy.deepcopy(modelo_sub)
        antes_de.addprevious(nuevo)
        escribir(nuevo, texto)
        return nuevo

    def vineta(despues_de, texto):
        nuevo = copy.deepcopy(modelo_vineta)
        despues_de.addnext(nuevo)
        escribir(nuevo, texto)
        return nuevo

    def imagen(despues_de, ruta):
        return imagen_despues(doc, modelo_imagen, despues_de, ruta)

    escribir(P[0], 'Para para ejecutar “Mirror Studio”')

    # 1. Requisitos Previos
    escribir(P[2], 'Mirror Studio sirve para hacer reuniones entre computadoras de una misma red local: presentar la '
                   'pantalla y, con permiso, controlar otra PC. Se necesita una PC con Windows 10 u 11 de 64 bits por '
                   'cada persona, con Mirror Studio abierto en todas; para probar una reunión hacen falta al menos '
                   'dos PCs. En Ubuntu se puede ejecutar desde el código fuente, pero el control remoto y el sonido '
                   'de la PC solo funcionan en Windows.')
    escribir(P[3], 'Conexión a Internet solo para descargar. Las reuniones funcionan sin Internet.')
    escribir(P[4], 'Todas las PCs conectadas a la misma red local (la red de un mismo lugar, sin pasar por Internet): '
                   'de preferencia por cable Ethernet al mismo switch (el aparato al que llegan los cables de red); '
                   'también sirve la misma Wi-Fi o un mismo hotspot (la Wi-Fi que comparte un celular u otra PC), si '
                   'esa red no aísla los equipos entre sí.')
    clonar_despues(P[4], 'Si solo quieres usar la aplicación, no necesitas instalar nada más: ve directamente '
                         'al punto 3, «Ejecución desde archivo ejecutable». El punto 2 es para quien quiera '
                         'ejecutar el código fuente (las instrucciones del programa tal como se escribieron), por '
                         'ejemplo para revisarlo.')

    # 2. Ejecución desde el código fuente
    escribir(P[6], 'Ejecución desde el código fuente')
    escribir_con_enlace(doc, P[7], 'Se necesitan dos programas gratuitos: Git (https://git-scm.com), que descarga '
                        'el proyecto, y Node.js versión 22 o superior (', URL_NODE, '), que lo ejecuta; Node.js '
                        'trae incluido npm, el programa que descarga los componentes que Mirror Studio necesita. '
                        'Instálalos en este orden, como se explica a continuación.')
    escribir(P[8], 'Si ya los tienes instalados, ve directamente al punto 2.3, «Comprobar la instalación».')

    # 2.1 Instalar Git
    s1 = sub(P[10], 'Instalar Git')
    v = vineta(s1, 'Abre el navegador (Chrome, Edge u otro) y entra a https://git-scm.com/downloads/win. Pulsa '
                   '«Click here to download» («haz clic aquí para descargar») (1); se descarga el instalador para '
                   'Windows de 64 bits.')
    imagen(v, IMG_GIT)
    v = vineta(v.getnext(), 'Abre el archivo descargado (Git-…-64-bit.exe) y, si Windows pregunta si quieres '
                            'permitir cambios, pulsa «Sí». En el asistente no cambies nada: pulsa «Next» en '
                            'cada pantalla, luego «Install» y al final «Finish».')

    # 2.2 Instalar Node.js
    s2 = sub(P[10], 'Instalar Node.js')
    v = vineta(s2, 'Entra a https://nodejs.org/es/download. Deja la versión que la página propone, marcada como '
                   'LTS (versión de soporte prolongado, la más estable). Comprueba que estén elegidos «Windows» y '
                   '«x64» y pulsa «Windows Installer (.msi)» (1). No hace falta copiar los comandos que la página '
                   'muestra más arriba.')
    imagen(v, IMG_NODE)
    vineta(v.getnext(), 'Abre el archivo descargado (node-v…-x64.msi). Pulsa «Next», marca «I accept the terms in '
                        'the License Agreement» y sigue con «Next» sin cambiar nada; así queda marcada la opción '
                        '«Add to PATH», que permite a Windows encontrar Node.js cuando escribas sus comandos. Pulsa '
                        '«Install», responde «Sí» al aviso de Windows y al final pulsa «Finish».')

    # 2.3 Comprobar la instalación
    s3 = sub(P[10], 'Comprobar la instalación')
    v = vineta(s3, 'Abre el menú Inicio, escribe PowerShell y ábrelo; es una ventana donde se escriben órdenes '
                   '(comandos) con el teclado. Si ya tenías una abierta antes de instalar, ciérrala y abre una nueva. '
                   'Escribe estos comandos, uno por uno, y pulsa Enter después de cada uno: git --version, '
                   'node --version y npm --version. Cada uno debe responder con un número de versión, como en la '
                   'imagen; el de node debe empezar por v22 o un número mayor.')
    imagen(v, IMG_VERSIONES)

    # 2.4 Descargar el proyecto (subpunto de la plantilla)
    escribir(P[10], 'Descargar el proyecto')
    escribir_con_enlace(doc, P[11], 'En la misma ventana de PowerShell escribe cd Documents y pulsa Enter (cd '
                        'significa «entrar a la carpeta»; Documents es tu carpeta Documentos). Luego escribe '
                        'git clone ', URL_REPO, ' y pulsa Enter: «clonar» es descargar una copia completa del '
                        'proyecto desde GitHub, el sitio web donde está publicado. Por último escribe '
                        'cd mirror-studio y pulsa Enter. El proyecto queda en la carpeta Documentos\\mirror-studio.')
    img = imagen(P[11], IMG_CLONAR)
    v = vineta(img, 'Otra forma, sin usar git clone: en https://github.com/HernanVilc4/mirror-studio pulsa «Code» '
                    '(1). Ahí está la misma dirección que usa git clone (2), y «Download ZIP» (3) descarga el '
                    'proyecto comprimido (mirror-studio-main.zip). Haz clic derecho sobre él → «Extraer todo» → '
                    '«Extraer», entra a la carpeta extraída hasta ver el archivo package.json, haz clic derecho en '
                    'un espacio vacío y elige «Abrir en Terminal» (en Windows 10: Mayús + clic derecho → «Abrir la '
                    'ventana de PowerShell aquí»).')
    imagen(v, IMG_GITHUB)

    # 2.5 Instalar dependencias
    escribir(P[13], 'En la misma ventana (ya dentro de la carpeta mirror-studio) escribe npm install y pulsa Enter: '
                    'descarga los componentes que el programa necesita y la primera vez tarda unos minutos. Después '
                    'escribe npm run build -w @mirror-studio/protocol y pulsa Enter: prepara una parte interna del '
                    'programa. Los mensajes en inglés «npm warn» y el resumen de «vulnerabilities» son avisos de npm, '
                    'no errores, y no impiden usar la aplicación; no ejecutes «npm audit fix», que la pantalla '
                    'sugiere, porque puede cambiar versiones del proyecto. (Las imágenes de este punto y del '
                    'siguiente se tomaron en «Símbolo del sistema»; en PowerShell los comandos y los resultados son '
                    'los mismos.)')
    cambiar_imagen(doc, P[14].xpath('.//w:r[w:drawing]')[0], IMG_INSTALAR)

    # 2.6 Ejecutar: texto, salto de línea e imagen en el mismo párrafo, como en la plantilla.
    corrida_texto = P[15].find(qn('w:r'))
    corrida_salto = next(r for r in P[15].findall(qn('w:r')) if r.find(qn('w:br')) is not None)
    corrida_imagen = next(r for r in P[15].findall(qn('w:r')) if r.find(qn('w:drawing')) is not None)
    dejar_solo(P[15], [corrida_texto, corrida_salto, corrida_imagen])
    poner_texto(corrida_texto, 'Ejecutar la aplicación con: npm run dev (escríbelo y pulsa Enter). La consola '
                               'muestra «start electron app...» (primera imagen) y, unos segundos después, se abre '
                               'la ventana de Mirror Studio (segunda imagen). Deja PowerShell abierto mientras uses '
                               'la aplicación. Para cerrarla, cierra la ventana de Mirror Studio o pulsa Ctrl+C en '
                               'PowerShell. Otro día, abre PowerShell, escribe cd Documents\\mirror-studio y luego '
                               'npm run dev:')
    cambiar_imagen(doc, corrida_imagen, IMG_DEV)
    inicio = imagen(P[15], IMG_INICIO)

    # 2.7 Firewall, con un subpunto y una viñeta como los de 2.5 (mismo formato).
    s7 = copy.deepcopy(P[12])
    inicio.addnext(s7)
    escribir(s7, 'Permitir la aplicación en el firewall (imprescindible en la PC que crea la reunión)')
    v = copy.deepcopy(P[13])
    s7.addnext(v)
    escribir(v, 'El firewall es la protección de Windows que bloquea las conexiones que llegan de otras PCs; sin '
                'este paso, los demás no pueden unirse. En la pantalla principal pulsa «Ayuda de red»: la ventana '
                '«Red y firewall» muestra el comando exacto para ese equipo (1). Haz clic sobre el comando (se '
                'selecciona completo) y pulsa Ctrl+C. Luego, en el menú Inicio, escribe PowerShell, haz clic '
                'derecho sobre el resultado → «Ejecutar como administrador» y responde «Sí». Pega el comando con '
                'clic derecho (o Ctrl+V) y pulsa Enter; debe responder «Aceptar.». Al volver a abrir Mirror Studio, '
                'el pie dirá «Firewall permitido». Se hace una vez por cada copia del programa: si mueves la '
                'carpeta o usas la versión portable, repítelo.')
    imagen(v, IMG_AYUDA)

    # 3. Ejecución desde archivo ejecutable (.exe)
    escribir(P[17], 'Descargar Mirror Studio')
    escribir(P[18], 'Entra a ' + URL_RELEASE + ' (página de la versión 0.1.0) y, al final, en «Assets» '
                    '(archivos), pulsa «Mirror-Studio-win32-x64.zip» (1), de unos 130 MB. Es la versión portable: '
                    'no se instala, se usa directamente desde su carpeta, y funciona aunque Windows 11 tenga '
                    'activado el Control inteligente de aplicaciones (una protección que bloquea programas sin '
                    'firma digital).')
    img = imagen(P[18], IMG_RELEASE)
    v = clonar_despues(P[18], 'Busca el archivo en la carpeta Descargas, haz clic derecho sobre él y elige '
                              '«Extraer todo» → «Extraer». Un .zip es un archivo comprimido: hay que extraerlo '
                              'completo; no abras el programa desde dentro del .zip.')
    img.addprevious(P[18])  # orden: texto, imagen, viñetas siguientes
    img.addnext(v)
    clonar_despues(v, 'En la misma página está el instalador (Mirror-Studio-Setup-0.1.0.exe): instala el programa '
                      'para todos los usuarios, crea accesos directos y permite el programa en el firewall (punto '
                      '2.7) automáticamente; pide permiso de administrador. No tiene firma digital (el sello que '
                      'identifica al fabricante ante Windows): si Windows muestra «Una directiva de Control de '
                      'aplicaciones bloqueó este archivo», usa la versión portable.')
    escribir(P[20], 'Abre la carpeta extraída Mirror-Studio-win32-x64 y, dentro, la carpeta del mismo nombre. Haz '
                    'doble clic en Mirror Studio (tipo «Aplicación»; se ve como Mirror Studio.exe si Windows '
                    'muestra las extensiones; es normal que su icono no sea el logotipo de Mirror Studio). Se abre '
                    'la pantalla principal, igual a la segunda imagen del punto 2.6. En la PC que creará la reunión '
                    'haz también el punto 2.7 (firewall): el comando de «Ayuda de red» es distinto para esta copia '
                    'del programa.')
    escribir(P[21], 'Importante: el programa no tiene firma digital; por eso Windows puede mostrar «Windows protegió '
                    'su PC» (SmartScreen, el filtro de seguridad de Windows). Pulsa «Más información» y luego '
                    '«Ejecutar de todos modos». Hazlo solo con el archivo descargado de la página oficial del '
                    'proyecto.')

    # Tabla de errores: filas de la plantilla reescritas y dos más clonadas de la última.
    filas = tabla.findall(qn('w:tr'))

    def fila(tr, problema, solucion):
        c1, c2 = tr.findall(qn('w:tc'))
        escribir(c1.find(qn('w:p')), problema)
        escribir(c2.find(qn('w:p')), solucion)

    fila(filas[1], "PowerShell responde «El término 'git' (o 'node', 'npm') no se reconoce como nombre de un "
                   "cmdlet…»",
         'Cierra PowerShell y vuelve a abrirlo. Si sigue, reinstala ese programa dejando todas las opciones '
         'como vienen.')
    fila(filas[2], '«Windows protegió su PC» (SmartScreen)',
         'Pulsa «Más información» y luego «Ejecutar de todos modos». Aparece porque el programa no tiene firma '
         'digital.')
    fila(filas[3], '«Una directiva de Control de aplicaciones bloqueó este archivo»',
         'Windows 11 con el Control inteligente de aplicaciones activado bloquea el instalador. Usa la versión '
         'portable: Mirror-Studio-win32-x64.zip.')
    extra = copy.deepcopy(filas[3])
    filas[3].addnext(extra)
    fila(extra, 'La otra PC no ve la reunión o no puede entrar',
         'Permite la aplicación en el firewall (punto 2.7) y pon la red como privada: Configuración → Red e '
         'Internet → Wi-Fi o Ethernet → propiedades de la red → «Tipo de perfil de red» → «Red privada». Si la '
         'reunión no aparece en la lista, usa «Unirse con IP y código».')
    extra2 = copy.deepcopy(extra)
    extra.addnext(extra2)
    fila(extra2, 'Aparece «El puerto 47800 ya está en uso»',
         'Ya hay otra ventana de Mirror Studio abierta en esa PC. Ciérrala (si no la ves, ciérrala desde el '
         'Administrador de tareas, Ctrl+Mayús+Esc) y vuelve a intentarlo.')

    numerar_dibujos(body)
    quitar_imagenes_sin_uso(doc)
    quitar_restos_de_maquetacion(body)

    cp = doc.core_properties
    cp.title = 'Mirror Studio 0.1.0 – Para ejecutar'
    cp.author = 'Mirror Studio'
    cp.last_modified_by = 'Mirror Studio'
    cp.subject = cp.keywords = cp.category = cp.comments = ''
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
    # La guía lleva más capturas que la plantilla: todas deben tener uno de los anchos de las de la plantilla.
    if not b['imagenes'] or {x[0] for x in b['imagenes']} - {x[0] for x in a['imagenes']}:
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
