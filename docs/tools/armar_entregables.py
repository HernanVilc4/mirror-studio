"""Actualiza los tres Word conservando las plantillas del repositorio.

No simula capturas: cuando no existe una imagen real deja un aviso pendiente.
El inventario JSON permite comprobar qué revisión y archivos contiene la entrega.
Ejecutar: python docs/tools/armar_entregables.py
"""
from __future__ import annotations

import copy
import hashlib
import json
import subprocess
import sys
from pathlib import Path

from docx import Document
from docx.oxml.ns import qn
from docx.text.paragraph import Paragraph

ROOT = Path(__file__).resolve().parents[2]
DOCS = ROOT / 'docs'
OUT = DOCS / 'entregables'
SOURCES = [
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


def template(pattern):
    return Document(next(DOCS.glob(pattern)))


def replace(p, text):
    """Conserva pPr y el formato del primer run, incluso en celdas."""
    model = copy.deepcopy(p.runs[0]._r.rPr) if p.runs and p.runs[0]._r.rPr is not None else None
    for child in list(p._p):
        if child.tag != qn('w:pPr'):
            p._p.remove(child)
    run = p.add_run(text)
    if model is not None:
        run._r.insert(0, model)


def screenshot(p, path, label, width=None):
    drawings = p._p.xpath('.//wp:extent')
    old_width = int(drawings[0].get('cx')) if drawings else 5000000
    # Algunas imágenes comparten párrafo con instrucciones: conserva el texto.
    existing = p.text.strip()
    replace(p, existing)
    if path and path.exists():
        p.add_run().add_break() if existing else None
        p.add_run().add_picture(str(path), width=width or old_width)
        return True
    p.add_run(('\n' if existing else '') + f'[Captura pendiente: {label}]')
    return False


def clean_images(doc):
    used = set(doc.element.body.xpath('.//@r:embed | .//@r:id | .//@r:link'))
    for rid, rel in list(doc.part.rels.items()):
        if rel.reltype.endswith('/image') and rid not in used:
            doc.part.rels.pop(rid)


def execution():
    doc = template('pushpromaster - para para ejecutar_*.docx')
    texts = {
        0: 'Para para ejecutar “Mirror Studio”',
        1: 'Requisitos Previos',
        2: 'Windows 10/11 (64 bits). Ubuntu también abre la aplicación, pero la PC que recibe control remoto debe tener Windows. Todas las PCs deben estar en la misma red local.',
        3: 'Git (https://git-scm.com) y Node.js 22 LTS o superior (https://nodejs.org), necesarios solo para ejecutar desde el código fuente.',
        4: 'Conexión a Internet para descargar el proyecto y sus dependencias. Las reuniones funcionan sin Internet. No se necesita una cuenta de GitHub para usar la aplicación.',
        6: 'Ejecución desde el código fuente',
        7: 'Instala Node.js 22 LTS o superior desde https://nodejs.org e instala Git desde https://git-scm.com.',
        8: 'Durante la instalación de Node.js, conserva la opción de añadirlo al PATH. Comprueba la instalación con node --version y npm --version.',
        10: 'Descargar o clonar el proyecto',
        11: 'Clona el repositorio con Git:\ngit clone https://github.com/HernanVilc4/mirror-studio.git\ncd mirror-studio\nSi ya tienes el proyecto, usa git pull y cierra la instancia anterior antes de volver a abrirla.',
        12: 'Instalar dependencias',
        13: 'Abre una terminal en la raíz del proyecto y ejecuta:\nnpm install\nnpm run build -w @mirror-studio/protocol',
        15: 'Ejecuta en la raíz del proyecto:\nnpm run dev\nTambién puedes abrir la carpeta en Visual Studio Code y usar su terminal. Si actualizas main o preload, detén y vuelve a ejecutar la aplicación.\nEn “Ayuda de red” está el comando del firewall con la ruta de ese equipo. Ejecútalo una vez como administrador en las PCs que lo necesiten: la regla por programa permite TCP 47800 y el tráfico UDP de WebRTC en perfiles Privado y Dominio.',
        16: 'Ejecución desde archivo ejecutable (.exe)',
        17: 'Generar u obtener el ejecutable',
        18: 'Para generar el portable, ejecuta npm run dist:portable. Crea release/Mirror-Studio-win32-x64.zip; descomprímelo conservando todos sus archivos y abre Mirror Studio.exe. Para generar el instalador ejecuta npm run dist -w @mirror-studio/desktop; queda en release/Mirror Studio Setup 0.1.0.exe. El instalador configura la regla de firewall; el portable requiere configurarla manualmente.',
        19: 'Ejecutar',
        20: 'Haz doble clic en Mirror Studio.exe o ejecuta el instalador. En todas las PCs usa la misma versión. Al abrir aparece la marca Doble Erre y la pantalla principal; el selector superior permite usar tema claro, oscuro o el del sistema.',
        21: 'Importante: el ejecutable no está firmado digitalmente. Windows puede mostrar SmartScreen. Comprueba el origen del archivo; si confías en él, la opción “Más información” permite “Ejecutar de todos modos”.',
        22: 'Posibles advertencias o errores comunes',
    }
    for index, text in texts.items():
        replace(doc.paragraphs[index], text)
    terminal_deps = DOCS / 'manual' / 'capturas' / 'ejecucion-dependencias.png'
    terminal_app = DOCS / 'manual' / 'capturas' / 'ejecucion-app.png'
    # Si no hay capturas de terminal, ilustra la guía con pantallas reales de
    # la aplicación. No presenta una imagen de la app como prueba de comandos.
    if not terminal_deps.exists():
        replace(doc.paragraphs[13], texts[13] + '\nDespués de arrancar la aplicación, abre “Ayuda de red”. Allí aparece el comando del firewall con la ruta de este equipo, como muestra la captura siguiente. Ejecútalo una vez como administrador si otras PCs no pueden conectarse; la regla por programa permite TCP y UDP en perfiles Privado y Dominio.')
    if not terminal_app.exists():
        replace(doc.paragraphs[15], 'Ejecuta en la raíz del proyecto:\nnpm run dev\nTambién puedes abrir la carpeta en Visual Studio Code y usar su terminal. Si actualizas main o preload, detén y vuelve a ejecutar la aplicación. La captura siguiente muestra la pantalla principal tras el arranque: puedes crear una reunión, unirte por IP y código o elegir una reunión detectada. Usa la misma versión en todas las PCs.')
    pending = []
    for index, filename, fallback, label in [
        (14, 'ejecucion-dependencias.png', '26-ayuda-red.png', 'ayuda de red de MirrorStudio'),
        (15, 'ejecucion-app.png', '01-inicio.png', 'ventana principal real de MirrorStudio abierta'),
    ]:
        image_path = DOCS / 'manual' / 'capturas' / filename
        if not image_path.exists():
            image_path = DOCS / 'manual' / 'capturas' / fallback
        if not screenshot(doc.paragraphs[index], image_path, label):
            pending.append(filename)
    rows = [
        ('Node.js o npm no encontrado', 'Instala Node.js y conserva la opción de añadirlo al PATH. Cierra y vuelve a abrir la terminal. Git se usa para clonar o actualizar el proyecto.'),
        ('Advertencia de seguridad de Windows', 'El ejecutable no está firmado digitalmente. Verifica que procede de la distribución autorizada antes de ejecutarlo.'),
        ('No conecta, no hay imagen o el puerto está en uso', 'Usa la misma versión en todas las PCs y revisa IP, código y perfil de red. Permite la aplicación con el comando de “Ayuda de red” (incluye TCP y UDP). Si el puerto 47800 está ocupado, cierra la otra instancia de Mirror Studio.'),
    ]
    for row, values in zip(doc.tables[0].rows[1:], rows):
        for cell, value in zip(row.cells, values):
            replace(cell.paragraphs[0], value)
            for p in cell.paragraphs[1:]:
                p._p.getparent().remove(p._p)
    clean_images(doc)
    path = OUT / 'Mirror Studio - para ejecutar.docx'
    doc.save(path)
    return path, pending


def source():
    doc = template('pushpromaster - codigo fuente_*.docx')
    pending = []
    for p in doc.paragraphs:
        if p._p.xpath('.//w:drawing'):
            image = DOCS / 'manual' / 'capturas' / '01-inicio.png'
            if not image.exists():
                image = DOCS / 'manual' / 'capturas' / 'inicio-anfitrion.png'
            if not screenshot(p, image, 'ventana principal real de MirrorStudio'):
                pending.append('01-inicio.png')
    cell = doc.tables[0].cell(1, 0)
    proto = copy.deepcopy(cell.paragraphs[0]._p)
    # Word exige identificadores únicos; deja que los regenere al abrir el archivo.
    for key in list(proto.attrib):
        if key.endswith('}paraId') or key.endswith('}textId'):
            del proto.attrib[key]
    for p in list(cell.paragraphs):
        cell._tc.remove(p._p)
    inventory = []
    for name in SOURCES:
        raw = (ROOT / name).read_bytes()
        text = raw.decode('utf-8')
        lines = [f'// {name}', *text.splitlines(), '']
        for line in lines:
            el = copy.deepcopy(proto)
            cell._tc.append(el)
            replace(Paragraph(el, cell), line)
        inventory.append({'path': name, 'sha256': hashlib.sha256(raw).hexdigest(), 'lines': len(text.splitlines())})
    clean_images(doc)
    path = OUT / 'Mirror Studio - codigo fuente.docx'
    doc.save(path)
    # Verifica el código contra los archivos actuales, sin depender del Word abierto.
    expected = []
    for name in SOURCES:
        expected.extend([f'// {name}', *(ROOT / name).read_text(encoding='utf-8').splitlines(), ''])
    actual = [p.text for p in Document(path).tables[0].cell(1, 0).paragraphs]
    if actual != expected:
        raise RuntimeError('El texto del Word no coincide con los archivos fuente.')
    return path, pending, inventory


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for name in ['capturas', 'anotadas']:
        (DOCS / 'manual' / name).mkdir(parents=True, exist_ok=True)
    manual = subprocess.run([sys.executable, str(DOCS / 'tools' / 'armar_manual.py')], check=True, capture_output=True, text=True, encoding='utf-8')
    print(manual.stdout)
    exe, pending_exe = execution()
    src, pending_src, inventory = source()
    revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    report = {'commit': revision, 'source_files': inventory,
              'pending_execution_images': pending_exe, 'pending_source_images': pending_src,
              'execution_images': {
                  'dependencies': 'ejecucion-dependencias.png' if (DOCS / 'manual/capturas/ejecucion-dependencias.png').exists() else '26-ayuda-red.png',
                  'startup': 'ejecucion-app.png' if (DOCS / 'manual/capturas/ejecucion-app.png').exists() else '01-inicio.png',
              },
              'manual_result': manual.stdout.splitlines()}
    (OUT / 'inventario-documentacion.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'Actualizados: {exe.name}; {src.name}')
    print(f'Capturas adicionales pendientes: {len(pending_exe) + len(pending_src)}')


if __name__ == '__main__':
    main()
