# Guía para hacer la documentación de Mirror Studio

La documentación de Mirror Studio son **tres documentos Word**. Cada uno debe seguir **exactamente** la plantilla correspondiente que está en esta carpeta `docs/`:

| Documento a entregar | Plantilla que se copia |
|---|---|
| Para ejecutar «Mirror Studio» | `pushpromaster - para para ejecutar_….docx` |
| Manual de Uso - Mirror Studio | `pushpromaster - manual de uso_….docx` |
| Código fuente | `pushpromaster - codigo fuente_….docx` |

## Regla principal: no cambiar el formato

Los documentos deben verse **igual que las plantillas**:
- misma estructura y orden de secciones
- mismos títulos y numeración
- mismas fuentes, tamaños, colores, márgenes, tamaño de página e interlineado
- mismos tipos de lista y pie de página

Solo cambia el **contenido**: de PushProMaster a Mirror Studio. Las plantillas tienen un estilo sencillo, hecho a mano en Word, y así debe quedar.

**Cómo trabajar:**
1. Copia el `.docx` de la plantilla y renómbralo (por ejemplo `Mirror Studio - manual de uso.docx`). **No empieces un documento en blanco.**
2. Abre la copia y **sobrescribe el texto** de cada sección, sin borrar los párrafos que llevan el formato. Al pegar texto, usa **Pegar → Mantener solo texto** (Ctrl+Mayús+V) para que no traiga otro formato.
3. Reemplaza las capturas de PushProMaster por capturas reales de Mirror Studio, del mismo tamaño aproximado y en el mismo lugar.
4. Conserva la tabla de la plantilla, sus bordes y el pie de página; no los vuelvas a crear.

**Qué no hacer:**
- No cambiar fuentes, colores ni tamaños. No usar el tema de Word, estilos nuevos ni «Diseño».
- No añadir secciones, índices, portadas, cuadros de colores, iconos, emojis ni negritas que la plantilla no tenga.
- No convertir el texto en tablas ni en viñetas si en la plantilla es un párrafo, y al revés tampoco.
- No pegar texto con formato desde páginas web, Markdown o la terminal (`#`, `**`, `|`, viñetas raras).
- No cambiar el tamaño de página ni los márgenes. Cada plantilla tiene los suyos, abajo.

## 1. «Para ejecutar» (plantilla `pushpromaster - para para ejecutar_….docx`)

**Formato (no tocar):**

| Elemento | Formato de la plantilla |
|---|---|
| Página | A4, márgenes 2,5 cm arriba y abajo, 3 cm izquierda y derecha |
| Título | Una línea centrada, Times New Roman 14 pt. El texto sigue el patrón de la plantilla, cambiando solo el nombre: «Para para ejecutar “Mirror Studio”» |
| Texto | Times New Roman 12 pt, interlineado ~1,15, 8 pt después de cada párrafo |
| Listas | Las listas numeradas y las viñetas de la plantilla (secciones numeradas, subpuntos y viñetas), con estilo «Párrafo de lista» |
| Otros | 1 tabla y 2 imágenes en los mismos sitios que la plantilla |

**Contenido de Mirror Studio, en el orden de la plantilla:**
1. **Requisitos Previos**
   - Windows 10/11 (Ubuntu también abre la app, pero el control remoto es solo de Windows).
   - Git: https://git-scm.com
   - Node.js 22 LTS o superior: https://nodejs.org
   - Todas las PCs en la misma red local. Internet solo para instalar.
2. **Ejecución desde el código fuente**
   - Instalar Node.js; en el instalador, dejar marcada la opción de añadirlo al PATH.
   - Descargar o clonar el proyecto: `git clone https://github.com/HernanVilc4/mirror-studio.git`
   - Instalar dependencias: en la carpeta del proyecto, `npm install` y luego `npm run build -w @mirror-studio/protocol`. Captura de la terminal en el sitio de la imagen de la plantilla.
   - Ejecutar la aplicación: `npm run dev`. También se puede abrir la carpeta en Visual Studio Code y usar su terminal. Captura de la terminal y de la ventana abierta.
   - Firewall (solo la PC anfitriona): el comando de la sección 3 de `GUIA-PRUEBAS-LAN.md`.
3. **Ejecución desde archivo ejecutable (.exe)**
   - Generar el paquete: `npm run dist:portable` crea `release/Mirror-Studio-win32-x64.zip`. Descomprimir y ejecutar `Mirror Studio.exe`. El instalador se genera con `npm run dist -w @mirror-studio/desktop` y queda como `release/Mirror Studio Setup 0.1.0.exe`.
   - Ejecutar: doble clic. Windows mostrará SmartScreen porque no está firmado: *Más información → Ejecutar de todos modos*.

## 2. «Manual de Uso» (plantilla `pushpromaster - manual de uso_….docx`)

**Formato (no tocar):**

| Elemento | Formato de la plantilla |
|---|---|
| Página | Carta (Letter), márgenes 2,54 cm arriba y abajo, 3,17 cm izquierda y derecha |
| Título | Estilo **Título**, centrado, 26 pt, color azul oscuro (#17365D): «Manual de Uso - Mirror Studio» |
| Secciones | Estilo **Título 1**, 14 pt, negrita, color azul (#365F91), numeradas a mano: «1. Introducción», «2. Requisitos del Sistema»… |
| Texto | Fuente del tema (Cambria) 11 pt, interlineado 1,15, 10 pt después de cada párrafo |
| Listas | Como en la plantilla: líneas que empiezan con «- » dentro del párrafo, no viñetas automáticas |
| Imágenes | Capturas de pantalla entre los párrafos del paso a paso (la plantilla tiene unas 30) |

**Secciones con el mismo nombre y número que la plantilla.** La plantilla pasa de la 5 a la 7, y se deja igual.
1. **Introducción:** Mirror Studio es una aplicación de escritorio para reuniones en red local sin Internet. Permite presentar la pantalla o una ventana con el sonido de la PC, y pedir el control remoto de otra PC con su permiso, con roles de creador, administrador, docente y participante.
2. **Requisitos del Sistema:** los de la sección 1 de esta guía, en líneas con «- ».
3. **Instalación:** resumen de «Para ejecutar», con el `.exe` o con el código fuente.
4. **Interfaz Principal:** captura de la pantalla de inicio y lista de sus partes:
   - tu nombre
   - Crear reunión
   - Unirse con IP y código
   - Reuniones en tu red
   - pie con la red y el firewall
5. **Flujo de Uso Paso a Paso:** cada paso con su captura, igual que en la plantilla.
   1. Crear una reunión (captura de la sala con IP y código).
   2. Copiar la IP y el código con sus botones.
   3. Unirse desde otra PC (lista de reuniones, o IP y código).
   4. Presentar la pantalla o una ventana, con el sonido de la PC.
   5. Ver la propia presentación y ocultarla (botón del ojo), y la pantalla completa.
   6. Asignar roles (menú «⋮» de cada participante).
   7. Pedir control de una PC, aceptar o rechazar, la barra roja, y detener el control (Ctrl+Alt+Esc o el botón).
   8. Ocultar o mostrar el panel de participantes.
   9. Salir o terminar la reunión.

   Al final, una captura de la aplicación completa, como hace la plantilla.
7. **Errores Comunes y Soluciones:** líneas con «- » tomadas de la tabla de la sección 7 de `GUIA-PRUEBAS-LAN.md`:
   - no aparece la reunión
   - firewall
   - IP de VirtualBox
   - código incorrecto
   - puerto en uso
8. **Consejos de Buen Uso:** líneas con «- »:
   - usar la misma versión en todas las PCs
   - preferir cable Ethernet
   - perfil de red Privada
   - cerrar VPN y máquinas virtuales
   - no compartir la misma ventana de Mirror Studio, para evitar el espejo infinito

## 3. «Código fuente» (plantilla `pushpromaster - codigo fuente_….docx`)

**Formato (no tocar):**

| Elemento | Formato de la plantilla |
|---|---|
| Página | A4, márgenes 2,5 cm arriba y abajo, 3 cm izquierda y derecha |
| Título | «CÓDIGO FUENTE», centrado, negrita y subrayado, 15 pt, negro |
| Imagen | Una imagen centrada bajo el título: captura de la ventana principal de Mirror Studio |
| Código | Dentro de la **tabla** de la plantilla: primera fila «CÓDIGO FUENTE»; debajo, el código en **Consolas 9,5 pt, negro**, con sus comentarios |
| Pie de página | «pág. N» con número automático (ya está en la plantilla) |

**Qué código va en la tabla:** se pega como texto sin formato y se conserva la sangría. Un archivo detrás de otro, cada uno precedido de una línea de comentario con su ruta (por ejemplo `// apps/desktop/src/main/meeting.ts`). Orden:
1. `packages/protocol/src/index.ts`: mensajes, roles y permisos.
2. `packages/protocol/src/node.ts`: emparejamiento con código y cifrado.
3. `apps/desktop/src/main/index.ts`: ventana, permisos y firewall.
4. `apps/desktop/src/main/meeting.ts`: lógica de la reunión en el anfitrión.
5. `apps/desktop/src/main/meeting-net.ts`: conexión por red.
6. `apps/desktop/src/main/network.ts`: elección de IP, búsqueda en la red y firewall.
7. `apps/desktop/src/main/input.ts`: control remoto (ratón y teclado).
8. `apps/desktop/src/preload/index.ts`
9. `apps/desktop/src/renderer/src/controller.ts`: estados de presentar y controlar.
10. `apps/desktop/src/renderer/src/media.ts`: vídeo y sonido (WebRTC).
11. `apps/desktop/src/renderer/src/App.tsx`: pantallas.

No se incluyen los archivos `*.test.ts`, `node_modules`, `out` ni `release`.

## Antes de entregar

- [ ] Abrir la plantilla y el documento nuevo lado a lado: fuentes, tamaños, colores, márgenes y numeración iguales.
- [ ] Ningún resto de PushProMaster (nombre, enlaces de `keinraf`, capturas viejas).
- [ ] Todas las capturas son de Mirror Studio y de la versión actual (`git pull` antes de capturar).
- [ ] Los comandos se probaron en una PC limpia siguiendo «Para ejecutar».
- [ ] Revisión de ortografía en Word (Revisar → Ortografía y gramática).
