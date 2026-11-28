# Guía para terminar la parte de escritorio de la app móvil

Para quien programe el escritorio (una persona o su Claude). La app Android y el protocolo v5 ya están hechos y probados con un teléfono real. **Falta la ventana del escritorio**: los paneles, el QR de vincular y algunos detalles. Aquí está todo lo necesario para terminarlo sin preguntar.

## Prompt para pegar en Claude

> Lee, en este orden: `docs/movil/GUIA-ESCRITORIO.md` (esta guía), `docs/movil/DECISIONES.md` y `packages/protocol/vectors/README.md`. Trabaja en una rama nueva a partir de `calebe`. Haz las tareas de la sección 3 en el orden indicado. En cada una: escribe la interfaz copiando el estilo de la app actual y los mockups de `docs/movil/prototipo/`, añade tests de lo que se pueda probar sin ventana, y comprueba que `npm test` y `npm run typecheck` pasan. No ejecutes nada que mueva el ratón o el teclado reales (pruebas de ráfaga, `control-soak`) sin pedir permiso. No cambies el protocolo ni las reglas del anfitrión sin avisar: la app Android depende de ellos. Al terminar cada tarea, di qué hiciste y qué comprobaste.

## 1. Dónde está cada cosa

| Qué | Dónde |
|---|---|
| Rama con todo lo hecho | `calebe` (partir de aquí; o de `main` cuando se fusione) |
| Decisiones, permisos y mensajes (qué es cada cosa y por qué) | `docs/movil/DECISIONES.md` |
| Mensajes v5 y sus reglas | `packages/protocol/src/index.ts` |
| Vectores de prueba (válidos e inválidos de cada mensaje, y un saludo con claves fijas) | `packages/protocol/vectors/` (`README.md` explica el formato) |
| Lógica del anfitrión (permisos, límites, manos, chat, encuestas, archivos, vincular, reenvío de láser) | `apps/desktop/src/main/meeting.ts` y `meeting-net.ts`, con sus tests |
| La sesión de esta PC (recibe mensajes del anfitrión) | `apps/desktop/src/main/app-session.ts` |
| Teclas de diapositivas (hecho) | `apps/desktop/src/main/input.ts` (`SLIDE_KEYS`, `RemoteInput.slide`) |
| Capa del láser y los trazos (hecho, versión inicial) | `apps/desktop/src/main/overlay.ts`, conectada en `main/index.ts` |
| Ventana de la app (React) | `apps/desktop/src/renderer/src/` (`App.tsx`, `controller.ts`, `store.ts`, `media.ts`) |
| Mockups de lo que falta en el escritorio | `docs/movil/prototipo/D1`…`D5` (HTML) y `ms.css` (colores y animaciones) |
| Figma con todo el prototipo | <https://www.figma.com/design/HQc3x1A6un1ZJQvJjybmo4> (sección «Escritorio · referencia») |
| App Android (para probar contra ella) | `apps/android/` |

## 2. Lo que ya funciona (no lo rehagas)

- **Protocolo v5**: `PROTOCOL_VERSION = 5`, saludo con `device` y `caps`, y todos los mensajes de las secciones 3 a 10 de `DECISIONES.md`. Los dos lados (TypeScript y Kotlin) pasan los mismos vectores.
- **El anfitrión valida todo**: permisos del chat (todos, docentes, apagado), enlaces solo http/https, historial de 200 mensajes, fila de manos que se baja sola, encuestas (un voto por persona, `counts` y `voters` según quién), archivos (50 MB, 200 MB por reunión, extensiones bloqueadas, SHA-256, cola de baja prioridad), vincular (token de 2 minutos y un solo uso), reenvío de `slide`, `pointer` e `ink` solo desde el teléfono vinculado hacia la PC que presenta.
- **Un teléfono nunca recibe `media-mode`** (decisión A5): no tiene relé TCP. Además `media.ts` (`Hub.enableRelay`) **nunca pasa a un teléfono al relé**, aunque su video parezca quieto: antes lo hacía y le quitaba el video. No lo cambies.
- **Teclas de diapositivas**: `slide` del teléfono vinculado pulsa →, ←, Inicio, Fin, B, W, F5 o Esc en la ventana que esté al frente. Tests en `input.test.ts`.
- **Láser y trazos**: ventana transparente, sin clics, siempre encima, sobre la pantalla principal, que existe solo mientras esta PC presenta. Sale en la captura de pantalla completa. Los trazos se borran al pasar de diapositiva.
- **La app Android** hace todo lo del lado del teléfono: entrar, video, presentar pantalla o cámara, controlar otra PC como touchpad, mano, chat, encuestas, archivos, vincular, diapositivas, láser, trazos.

## 3. Tareas, en orden de prioridad

Cada una dice qué hacer, dónde y cómo se sabe que está lista.

### 3.1 Vincular mi teléfono (mockup D1) — la más importante

Sin esto el teléfono no se puede vincular con la PC real, y de eso dependen las diapositivas, el láser y los trazos.

- **Interfaz:** en la sala, un botón «Vincular mi teléfono» (en el menú «Más» o junto a «Presentar»). Al pulsarlo, la PC envía `pair-create` (`window.studio.send({ t: 'pair-create' })`) y el anfitrión responde `pair-token { token, expiresAt }`.
- **Ventana del QR:** una `BrowserWindow` aparte con **`win.setContentProtection(true)`**. Es obligatorio: el QR da poder sobre la PC y no debe salir en ninguna captura ni en la presentación. Muestra el QR, la cuenta atrás de 2:00 y «Esperando al teléfono».
- **Contenido del QR:** `mirrorstudio://pair?ip=<ip>&port=<puerto>&code=<código sin guion>&token=<token>&v=5`. El `ip` es el de la interfaz elegida (`hostInfo.ip`).
- **Al vincularse:** cuando `state.participants` muestre `pairedWith` en esta PC, cierra la ventana y muestra «Vinculado con <nombre del teléfono>» con el botón «Desvincular» (`pair-end`). Si caduca, avisa y deja pedir otro.
- **QR:** no hay librería en el proyecto. Añade una pequeña y conocida (por ejemplo `qrcode`) y comprueba que se pinta a buen tamaño y con margen.
- **Lista cuando termine:** con el teléfono de prueba, escanear el QR vincula (el teléfono muestra «Vinculado con <PC>»); el QR no aparece en una captura de pantalla completa; un token usado o caducado no sirve (los tests del anfitrión ya lo cubren).
- **Cómo probar sin teléfono:** `apps/android/tools/pc-client.ts` (ver sección 5).

### 3.2 QR para unirse (mockup D2)

El encabezado de la sala ya tiene copiar IP y código. Añade «Unirse desde el teléfono»: un QR con `mirrorstudio://join?ip=…&port=…&code=…&v=5`. **Este QR sí puede mostrarse a la sala** (lleva lo mismo que la IP y el código). Una ventana normal, sin protección de captura. También sirve copiar ese enlace.

### 3.3 Panel de mensajes (mockup D3)

Un panel en la sala, con pestañas **Todos / Preguntas / Archivos**, igual que el teléfono.

- Lista con autor, rol, hora y cuerpo. Los mensajes `question` se distinguen. Los enlaces muestran el dominio y **se abren solo al pulsar** («Abrir»), nunca solos (`shell.openExternal` con la URL ya validada).
- Cuadro para escribir con selector «Para: Todos / Docentes» (`to: 'all' | 'teachers'`). Un docente puede escribir a personas concretas.
- Si el docente apagó el chat (`state.settings.chat === 'off'`) o está silenciado, el campo se desactiva con el aviso del mockup. Si es «solo docentes», un alumno solo escribe a docentes.
- **Moderación** para docentes (menú de cada mensaje): borrar para todos (`msg-delete`), marcar respondida (`msg-mark`), mostrar a todos con o sin nombre (`msg-show`), silenciar a la persona (`mute-chat`). Un alumno solo borra los suyos.
- **Ajustes de la sala** (`room-settings`): chat y archivos/enlaces en «Todos / Solo docentes / Apagado» y «Bloquear la sala».
- Contador de no leídos en el botón de mensajes.
- Los mensajes llegan por `UiEvent { t: 'message' }` (`msg`, `msg-history` justo después de `welcome`, `msg-delete`, `poll-state`). Guarda el estado en el `store`.
- **Lista cuando termine:** un mensaje escrito en el teléfono aparece aquí y al revés; con el chat en «solo docentes», un alumno de prueba no llega a «todos».

### 3.4 Participantes y manos (mockup D4)

- En la lista de participantes, el icono de mano con su número (`participant.hand`), las manos primero, un contador en la cabecera y la etiqueta del dispositivo («Teléfono» o «PC»). «Vinculado a <PC>» para un teléfono con `pairedWith`.
- Menú de cada persona con «Ayudar (pedir control)» (envía `control-request`; al aceptar su mano baja sola) y «Bajar la mano» (`hand-lower`).
- La pregunta de quien levanta la mano llega a los docentes como un `msg` de clase `question`; enlázala con su fila.

### 3.5 Archivos

- **Subir:** elegir archivo → `file-offer { name, size, sha256, mime }` → el anfitrión responde `file-accept { fileId }` → trozos de 48 KB con `FILE_TAG` (`MeetingClient.sendFileChunk`, `encodeFileChunk`) → `msg-send { body: { kind: 'file', fileId } }`.
- **Bajar:** `file-get { fileId }` → `file-meta` y trozos. `MeetingClient` ya emite el evento `'file'` con cada trozo, **pero `AppSession` aún no lo escucha**: conéctalo y pásalo a la ventana. Verifica el SHA-256, guarda en `Descargas/MirrorStudio/` y muestra «Abrir carpeta». **Nunca abras el archivo solo.**
- Límites que ya aplica el anfitrión: 50 MB por archivo, 200 MB por reunión, 3 archivos por minuto por persona, 2 descargas a la vez por receptor, extensiones bloqueadas (lista en `DECISIONES.md`, sección 9). La cuota por persona (25 MB propuestos) sigue abierta.
- En el anfitrión mismo no hay socket: lee el archivo con `MeetingHost.localFile(memberId, fileId)`.

### 3.5 bis Encuestas

Un modal para crear (`poll-create`: pregunta, de 2 a 6 opciones, anónima, varias respuestas, «mostrar resultados al cerrar») y tarjetas en el chat para responder y ver barras (`poll-vote`, `poll-close`, `poll-state`). Mira la pantalla 25, 26 y 27 del prototipo en Figma. Solo docentes crean y cierran.

### 3.6 Láser y trazos: lo que falta de la capa

La capa actual cubre la **pantalla principal completa**. Falta:

- Que siga a una **ventana** presentada (`GetWindowRect` cada 500 ms con el ayudante de `input.ts`) y que use el **monitor** que se presenta si no es el principal.
- El comando **`F <hwnd>`** del ayudante (`SetForegroundWindow` con el truco de `AttachThreadInput`) para traer al frente la ventana presentada antes de enviar una tecla de diapositivas (`DECISIONES.md`, sección 4). Hoy la tecla va a la ventana que esté al frente.
- **Aviso para el usuario:** al presentar *una ventana*, PowerPoint abre la presentación con diapositivas en **otra ventana**, y la sala sigue viendo el editor. Con pantalla completa no pasa. Pon una ayuda en el selector de «Presentar» o detecta el caso.
- Probar a mano: presentar pantalla completa, vincular el teléfono, láser y trazos desde el teléfono. Que la capa no reciba clics (todo pasa a lo de debajo) y se cierre al dejar de presentar.

### 3.7 Opcionales

- **`slide-state`** (fase 2, solo PowerPoint en Windows): leer la diapositiva actual y las notas por COM (`DECISIONES.md`, sección 4) y enviarlas al teléfono vinculado.
- **Calidad al presentar desde el teléfono**: hoy el teléfono captura a 1280 px en el lado largo, 15 cuadros por segundo y 2,5 Mbps (`apps/android/.../data/media/RtcMedia.kt`), y el centro de video recodifica con los límites de `videoLimits(viewers)` en `media.ts`. Se ve fluido pero algo borroso. Un ajuste «Normal / Alta» sería fácil.

## 4. Reglas que no se rompen

1. **El anfitrión valida todos los permisos.** Los clientes no se autorizan solos. Cada regla nueva lleva su test en `meeting.test.ts`.
2. **Un teléfono nunca usa el relé TCP ni se deja controlar** (decisiones A1 y A5). Si tocas `media.ts`, no quites la comprobación de `device === 'phone'`.
3. **El QR de vincular va en una ventana con `setContentProtection(true)`.**
4. **Los enlaces nunca se abren solos y los archivos nunca se abren solos.**
5. **Si cambias el protocolo**, actualiza `packages/protocol/src/index.ts`, regenera los vectores (`npm run vectors -w @mirror-studio/protocol`) y avisa: la app Android tiene que cambiar igual (`apps/android/core/protocol`, y su `VectorsTest` falla si no coincide).
6. **No ejecutes nada que mueva el ratón o el teclado reales** (el soak de control, pruebas de ráfaga) sin permiso explícito de quien esté en la PC. Las teclas de diapositivas sí se prueban con tests de `input.test.ts` con un driver falso.
7. Texto de la interfaz en español y neutral: sin ejemplos de una materia en concreto.
8. Mismo estilo de código y de interfaz que ya hay; sin comentarios decorativos.

## 5. Cómo probar sin teléfono

Todo se puede probar de punta a punta sin tocar un teléfono.

**Un anfitrión de prueba** (la misma lógica del anfitrión, sin ventana):

```
npx esbuild apps/android/tools/test-host.ts --bundle --platform=node --format=cjs --outfile=apps/android/build/test-host/test-host.cjs
MS_HOST=0.0.0.0 MS_PORT=47800 node apps/android/build/test-host/test-host.cjs      # imprime {"port":…,"code":"…"}
```

**Una PC auxiliar** que se une a tu reunión y escribe en pantalla lo que le llega (diapositivas, láser, trazos, mensajes, manos):

```
npx esbuild apps/android/tools/pc-client.ts --bundle --platform=node --format=cjs --outfile=apps/android/build/test-host/pc-client.cjs
MS_HOST=<ip> MS_PORT=47800 MS_CODE=<código sin guion> MS_NAME="PC auxiliar" node apps/android/build/test-host/pc-client.cjs
# por la entrada estándar: pair | present | stop | send <json> | quit
```

`pair` crea el token y escribe el enlace `mirrorstudio://pair?...`; `present` hace que esa PC presente (así el anfitrión reenvía láser y trazos); `send` manda cualquier mensaje del protocolo.

**La app de escritorio por código**, sin tocar el ratón: arráncala con depuración remota y ejecuta JS en la ventana.

```
cd apps/desktop && npx electron-vite dev -- --remote-debugging-port=9222
node apps/android/tools/cdp.cjs "document.body.innerText.slice(0, 300)"
node apps/android/tools/cdp.cjs "window.studio.send({ t: 'pair-create' })"
```

`window.studio` es la API de `preload/index.ts` (`host`, `join`, `send`, `onEvent`…). Así se crea una reunión, se pide el token de vincular y se leen los eventos.

**Pruebas automáticas:** `npm test` (protocolo y escritorio) y `npm run typecheck`. La app Android: `cd apps/android && ./gradlew :core:protocol:test :core:network:test`.

**Con un teléfono Android real** (depuración USB): `./gradlew :app:assembleDebug`, instalar `app/build/outputs/apk/debug/app-debug.apk`, y abrir un enlace `mirrorstudio://join?ip=…&port=47800&code=…&v=5` con `adb shell am start -a android.intent.action.VIEW -d '<enlace>' com.mirrorstudio.app`.

## 6. Cuando termines

- `npm test` y `npm run typecheck` en verde.
- Actualiza el apartado «Estado» al principio de `docs/movil/DECISIONES.md`: pasa lo hecho de «Falta» a «ya hecho».
- Prueba con un teléfono real al menos: vincular por QR, diapositivas y láser sobre una presentación, un mensaje en cada sentido, una mano levantada y un archivo de ida y vuelta.
- Abre el PR hacia `main` indicando qué probaste y qué no.

## 7. Cosas que se vieron probando (para no repetirlas)

- **Compartir una ventana de PowerPoint** no sigue a la presentación con diapositivas (otra ventana). Pantalla completa sí.
- Si **el teléfono presenta una pantalla casi quieta**, manda pocos cuadros; por eso el centro de video no debe tomarlo por un fallo de UDP (ya corregido para teléfonos).
- Un token de vincular que se pide **varias veces** reemplaza al anterior; solo vale el último.
- **El primer arranque del teléfono tarda** en consultar la reunión (lista de reuniones y pantalla de enlace); no es un fallo del anfitrión.
- Al **reiniciar el escritorio** se cierra la reunión: los teléfonos conectados intentan volver 5 veces y luego muestran «Se perdió la conexión».
