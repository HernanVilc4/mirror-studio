# App móvil y funciones de aula: decisiones

Fecha: 27 de noviembre de 2026.

**Para terminar la parte de escritorio: lee `docs/movil/GUIA-ESCRITORIO.md`** (tareas en orden, archivos, reglas, cómo probar y un prompt listo para Claude). Los mockups están en `docs/movil/prototipo/`.

**Estado:**
- **Protocolo v5 y anfitrión: implementados**, con tests. Están en `packages/protocol` (con los vectores en `packages/protocol/vectors/`) y en `apps/desktop/src/main/meeting.ts` y `meeting-net.ts`. Las decisiones tomadas donde este documento era ambiguo están en `packages/protocol/vectors/README.md` y en los comentarios de `meeting.ts`.
- **App Android: implementada contra v5.** Pasa los mismos vectores (`apps/android/core/protocol/.../VectorsTest.kt`).
- **Escritorio, ya hecho:** las teclas de diapositivas del teléfono vinculado (`input.ts`, `app-session.ts`) y la capa del láser y los trazos (`overlay.ts`). La capa cubre la pantalla principal; con una ventana presentada no coincide.
- **Falta en el escritorio** (filas de la sección 11 que tocan la ventana):
  - los paneles D1–D5 (chat, lista con manos, encuestas, QR para vincular y para unirse);
  - el comando `F <hwnd>` para traer al frente la ventana presentada;
  - que la capa siga a una ventana presentada y no solo a la pantalla;
  - el evento `'file'` de `MeetingClient` en `AppSession`.
- **Aviso:** PowerPoint abre la presentación en otra ventana. Si se comparte solo la ventana del editor, la sala sigue viendo el editor; hay que presentar la pantalla completa.

Prototipo (Figma, modo claro): <https://www.figma.com/design/HQc3x1A6un1ZJQvJjybmo4>
- Sección «Pantallas»: flujo base del teléfono (01–14).
- Sección «Funciones de aula · teléfono»: pantallas 15–27.
- Sección «Escritorio · referencia»: lo que debe mostrar la app de PC (D1–D5).
- Para recorrerlo: ▶ Presentar en Figma, con 4 flujos ya conectados.

Este documento es para **quien programa la app de escritorio**. Cada decisión dice qué cambia en el protocolo (`packages/protocol`), en el anfitrión (`apps/desktop/src/main/meeting.ts`) y en la ventana. Las secciones 6 a 9 (mensajería, mano, encuestas y archivos) son las que más trabajo dan en el escritorio.

---

## 0. Alcance

**Para toda la universidad, no solo para un laboratorio.** Cualquier clase de cualquier carrera lo usa como una videollamada tipo Meet, pero solo para quienes están en la red de la universidad (cableada o Wi-Fi) y sin licencias de terceros.

- **Escala:** un salón promedio tiene unas 35 personas. Cada clase es **una sala independiente**, con su docente como anfitrión, y puede haber muchas salas a la vez en el campus. No se diseña para salas de cientos de personas ni se necesita un servidor central: se mantiene la arquitectura actual (el anfitrión reparte el vídeo, tope de 35).
- **Los textos y ejemplos no son de ninguna materia.** En el prototipo y en la app: «Matemática II», «Docente», «Alumno»; nada de redes, IPs de laboratorio ni «Clase de Redes».
- **Cómo se entra a una sala:** con un **enlace o QR** que lleva la IP, el puerto y el código (`mirrorstudio://join?…`). El docente lo comparte por WhatsApp, el aula virtual o proyectándolo. La búsqueda automática en la red queda solo como ayuda dentro de la misma subred.
- **Requisitos de red que debe dar TI:** que las redes de las aulas y el Wi-Fi puedan abrir TCP 47800 hacia las PCs de los docentes, y que el Wi-Fi no aísle a los clientes (ver `FIREWALL.md`). Si UDP no pasa, ya existe el relé de vídeo por TCP.
- **Recomendación para docentes:** el PC del anfitrión por cable, no por Wi-Fi.
- **Para más adelante, no ahora:** iniciar sesión con el correo de la universidad, y un servidor que reparta vídeo en salas grandes.

## 1. Decisiones de arquitectura

| # | Decisión | Por qué |
|---|---|---|
| A1 | El teléfono es **siempre invitado**. Nunca crea reuniones ni se puede controlar | El anfitrión reparte vídeo a 35 personas y Android duerme las apps en segundo plano. Android solo deja inyectar entrada con un servicio de accesibilidad, y iPhone no lo permite |
| A2 | App Android **nativa en Kotlin**: Clean Architecture + MVVM, Jetpack Compose, Koin, Ktor (WebSocket), kotlinx.serialization y coroutines/`StateFlow`. Todo lo que no es pantalla ni hardware va en Kotlin puro | Si algún día se quiere iPhone, se pasa a **Kotlin Multiplatform** sin reescribir el dominio. Por eso Koin y no Hilt |
| A3 | Módulos: `core/protocol`, `core/network`, `core/media`, `feature/join`, `feature/room`, `feature/control`, `feature/slides`, `feature/messages`, `app` | Cada función se prueba sola |
| A4 | **El protocolo vive en dos lenguajes** (TypeScript y Kotlin). Para que no se separen, `packages/protocol` genera **vectores de prueba** en `packages/protocol/vectors/*.json`: mensajes válidos e inválidos y un saludo completo con claves fijas. Los tests de Kotlin deben reproducir exactamente lo mismo | Un cambio del protocolo rompe un test en vez de romper la clase |
| A5 | Vídeo en el teléfono: **solo WebRTC**. El teléfono declara que no tiene relé y el anfitrión **no** le cambia el enlace a `media-mode`. Si WebRTC no conecta, el teléfono lo dice («Tu red bloquea el vídeo») | El relé TCP decodifica con WebCodecs, que no existe en Android. Habría que hacer un decodificador MediaCodec nativo; se deja para más adelante |
| A6 | El cifrado se separa detrás de una interfaz en `packages/protocol/src/node.ts`. Kotlin usa la API nativa (X25519 desde Android 13) o BouncyCastle en versiones anteriores, con el mismo PBKDF2 de 200 000 iteraciones | Es el mismo saludo, verificado por los vectores de A4 |

## 2. Protocolo v5: lo común

`PROTOCOL_VERSION` pasa a **5**. Como siempre, todas las PCs y teléfonos deben tener la misma versión; si no, el aviso «versiones distintas» ya existe.

**Saludo.** `Hello` añade dos campos:

```ts
device: z.enum(['pc', 'phone']),
caps: z.array(z.enum(['relay', 'camera', 'overlay', 'files'])).max(8)
```

- Una PC envía `caps: ['relay', 'overlay', 'files']`.
- Un teléfono envía `['camera', 'files']`.

El anfitrión las guarda en el miembro. **Regla:** nunca se envía `media-mode` a quien no tenga `relay`.

**Participante.** `Participant` añade tres campos:

```ts
device: z.enum(['pc', 'phone']),
hand: z.number().int().min(1).nullable(),   // puesto en la fila de manos, null = mano bajada
pairedWith: id.nullable(),                  // teléfono ↔ PC del mismo dueño (sección 3)
```

**Límites nuevos por miembro.** Todos los controla el anfitrión, con un token bucket como el de `take()`:

| Mensaje | Límite |
|---|---|
| `slide` | 10 por segundo |
| `pointer` | 40 por segundo |
| `ink` | 60 trozos por segundo |
| `msg-send` | 5 cada 10 s |
| `hand` | 4 cada 10 s |
| `poll-vote` | 4 cada 10 s |
| Archivos | Ver sección 9 |

**Contenido de los QR** (los lee el teléfono):

| QR | Contenido |
|---|---|
| Unirse | `mirrorstudio://join?ip=192.168.137.1&port=47800&code=K7M2QX9P&v=5` |
| Vincular | `mirrorstudio://pair?ip=…&port=…&code=…&token=<base64url 16 bytes>&v=5` |

---

## 3. Vincular mi teléfono con mi PC (`pairing`)

**Para qué:** el teléfono controla la presentación de **su propia** PC (diapositivas, láser, trazos) sin el diálogo de consentimiento de cada vez. Es un permiso mucho más pequeño que el control remoto: no mueve el ratón ni escribe texto.

**Flujo** (D1 en Figma):
1. En la PC: «Más» → «Vincular mi teléfono». La PC envía `pair-create`.
2. El anfitrión responde `pair-token {token, expiresAt}`. El token es aleatorio, de 16 bytes, **dura 2 minutos y sirve una sola vez**.
3. La PC muestra el QR `mirrorstudio://pair…` en una **ventana aparte con `win.setContentProtection(true)`**. Así Windows la excluye de cualquier captura y no aparece si esa PC está presentando. **Esto es obligatorio**: el QR da poder sobre la PC.
4. El teléfono se une normalmente con la IP y el código y, después del `welcome`, envía `pair-claim {token}`.
5. El anfitrión comprueba que el token existe, no caducó y no se usó. Si todo está bien, pone `pairedWith` en ambos y emite `state`. Si falla, envía `notice` «El QR de vinculación caducó».
6. El vínculo termina cuando cualquiera de los dos sale o envía `pair-end`.

**Mensajes nuevos:**

| Dirección | Mensaje |
|---|---|
| Cliente → anfitrión | `pair-create {}` · `pair-claim {token: str(32)}` · `pair-end {}` |
| Anfitrión → cliente | `pair-token {token, expiresAt}` (solo a quien lo pidió) |

**Reglas del anfitrión:**
- Cada PC tiene como máximo un teléfono vinculado.
- Solo un miembro con `device:'phone'` puede reclamar un token.
- Solo una PC (`device:'pc'`) puede crearlo.

---

## 4. Control de diapositivas (`slide`)

**Mensaje:** `slide {action}`, con `action` ∈ `next | prev | first | last | black | white | start | end`.

**Quién:** solo el teléfono vinculado. El anfitrión reenvía `slide` **únicamente** a su `pairedWith`. No hace falta un campo de destino.

**Qué hace la PC que lo recibe:**

| `action` | Tecla |
|---|---|
| `next` | → |
| `prev` | ← |
| `first` | Inicio |
| `last` | Fin |
| `black` | B |
| `white` | W |
| `start` | F5 |
| `end` | Esc |

Se envía con el mismo ayudante de `input.ts` (comando `K`). **No** se usa `RemoteInput.begin()`: no hay concesión de control ni barra roja.

**Foco (importante).** Si en la PC hay otra ventana delante, la tecla va a esa ventana.
- Si se está presentando una **ventana** (id `window:<HWND>:0` de `desktopCapturer`), la PC la trae al frente antes de enviar la tecla.
- Para eso hay un comando nuevo del ayudante: `F <hwnd>`. Usa `SetForegroundWindow` con el truco de `AttachThreadInput`, porque Windows bloquea `SetForegroundWindow` desde procesos en segundo plano.
- Si se presenta la pantalla completa, la tecla va a la ventana activa.

**Respuesta opcional** (fase 2, solo PowerPoint en Windows): la PC envía `slide-state {index, total, nextTitle?, notes?}` a su teléfono.
- Lo lee por COM desde PowerShell: `[Runtime.InteropServices.Marshal]::GetActiveObject('PowerPoint.Application')`, luego `SlideShowWindows(1).View.Slide`.
- Las notas se truncan a 2000 caracteres.
- Con Canva y Google Slides no hay `slide-state`: el teléfono solo muestra la diapositiva actual (sacada del vídeo que ya recibe) y el temporizador.

**En el teléfono** (pantalla 17):
- Botones Anterior y Siguiente.
- Deslizar sobre la diapositiva.
- **Botones de volumen** (con la app en primer plano).
- Pantalla negra, temporizador con vibración.

---

## 5. Puntero láser y trazos (`pointer`, `ink`)

**Decisión: se dibujan en la PC que presenta, en una capa transparente encima de lo presentado** (D5 en Figma). Así los ven todos, porque salen en la captura, y también el proyector, sin tocar el vídeo ni la parte WebRTC.

**Capa.** Una `BrowserWindow` con estas opciones:

```
transparent: true, frame: false, focusable: false, skipTaskbar: true,
alwaysOnTop ('screen-saver'), setIgnoreMouseEvents(true)
```

- Se coloca sobre los límites de la pantalla o de la ventana presentada.
- Si la ventana se mueve, la capa la sigue (sondeo cada 500 ms con `GetWindowRect` en el ayudante).
- Es un canvas en la ventana.

**Mensajes** (coordenadas normalizadas 0..1 sobre lo presentado):

```ts
pointer {x: unit, y: unit, on: boolean}
ink {stroke: int, points: array([unit, unit]).max(32), color: enum(['red','blue','yellow','black']), width: enum([1,2,3]), tool: enum(['pen','highlighter']), done: boolean}
ink-undo {}   ink-clear {}
```

**Quién:**
- **Puede enviarlos** el presentador actual o su teléfono vinculado.
- El anfitrión los reenvía **solo a la PC presentadora** (`state.presenter`). Si quien presenta es un teléfono con su cámara (sección 10), no hay capa y se ignoran.
- **Cuándo se borran los trazos:** al cambiar de diapositiva (`slide next/prev`), al dejar de presentar y con `ink-clear`.

---

## 6. Mensajería: un solo canal para preguntas, enlaces, archivos y encuestas

**Decisión:** todo va por **un único tipo de mensaje** con un cuerpo distinto según su clase. La PC y el teléfono pintan la misma lista: pestañas Todos / Preguntas / Archivos en el teléfono (pantalla 23) y el panel D3 en la PC.

**Envío:**

```ts
msg-send {
  to: z.union([z.literal('all'), z.literal('teachers'), z.array(id).min(1).max(35)]),
  body: z.discriminatedUnion('kind', [
    { kind: 'text',     text: str(1000) },
    { kind: 'question', text: str(1000) },                          // siempre a 'teachers'
    { kind: 'link',     url: str(2000), title: str(120).optional() },
    { kind: 'file',     fileId: id },                               // después de subirlo (sección 9)
    { kind: 'poll',     pollId: id },                               // después de crearla (sección 8)
  ])
}
```

**Lo que reparte el anfitrión** (asigna `id`, `from` y `at`; el cliente nunca los elige):

```ts
msg {id, from, at: number, to: 'all'|'teachers'|id[], body, answered?: boolean, shown?: boolean}
```

**Permisos:**

| Quien envía | `text` | `question` | `link` / `file` | `poll` |
|---|---|---|---|---|
| Participante | **a todos** o solo a `teachers` | sí (a `teachers`, o a todos) | **a todos** o solo a `teachers` | no |
| Docente / admin / creador | a todos, a docentes o a personas concretas | — | igual que `text` | sí |

**Es un chat de grupo, como el de Meet o un grupo de WhatsApp:** todos ven lo que se escribe a «todos», y todos pueden escribir y enviar archivos y enlaces. Por defecto el destino es `all`. El destino `teachers` es un mensaje privado a los docentes («Preguntar solo al docente»), para que nadie tenga que preguntar delante de todos.

**Controles del docente** (docentes o superiores):
- `room-settings {chat: 'all'|'teachers'|'off', share: 'all'|'teachers'|'off', locked: boolean}`, con `'all'` por defecto en los dos y `locked: false`.
  - `locked: true` («Bloquear la sala»): el anfitrión rechaza a quien intente entrar con el mensaje «La sala está bloqueada». Los que ya están dentro no se ven afectados.
  - `chat` controla el texto: `all` abierto, `teachers` los alumnos solo escriben a los docentes, `off` solo escriben los docentes.
  - `share` controla archivos y enlaces con los mismos tres valores.
  - Va en `SessionState`, para que todos vean qué está permitido y la interfaz desactive el campo de escribir.
- `msg-delete {id}`: borra un mensaje de todos (aparece «Mensaje eliminado por el docente»). Un participante puede borrar solo los suyos.
- Silenciar a una persona: `mute-chat {target, on: boolean}`. No la expulsa; solo no puede escribir.

**Contra el spam:** el límite de 5 mensajes cada 10 s por persona ya está en la sección 2, y se añade un tope de 3 archivos por minuto.

**Acciones del docente sobre una pregunta:**
- `msg-mark {id, answered: boolean}`.
- `msg-show {id}`: la reenvía a todos marcada `shown`, sin el nombre del autor si así lo elige (`anonymous: boolean`).

**Historial:**
- El anfitrión guarda los **últimos 200** mensajes en memoria. Al terminar la reunión se borran.
- A quien entra tarde se le manda `msg-history {items: msg[]}` justo después del `welcome`, solo con lo que le corresponde ver.

**Seguridad de enlaces:**
- Solo `http:` y `https:`. El anfitrión rechaza lo demás (`file:`, `javascript:`…).
- **Nunca se abren solos.** Se muestra el dominio y se abre con `shell.openExternal` únicamente cuando la persona lo pulsa.

---

## 7. Levantar la mano (`hand`)

**Mensajes:**

| Dirección | Mensaje |
|---|---|
| Cliente → anfitrión | `hand {up: boolean, text?: str(200)}` (el texto es la pregunta opcional de la pantalla 21) |
| Cliente → anfitrión | `hand-lower {target: id}` (solo docentes o superiores) |

**Estado.** `participant.hand` guarda el puesto en la fila: 1 es el primero, y los puestos se reasignan al bajar una mano.
- El texto de la pregunta **no** va en `state`, que lo ven todos.
- Se envía solo a los docentes como `msg` de clase `question` con `from` = el alumno. Así queda en la pestaña Preguntas.

**Reglas del anfitrión:**
- Cualquiera puede subir o bajar **su propia** mano.
- Docentes o superiores pueden bajar la de cualquiera.
- Se baja sola cuando:
  - la persona sale;
  - un docente **empieza a controlar** su PC (el «Ayudar» de la pantalla 22 es un `control-request` normal);
  - la persona deja de estar en la reunión.
- A los docentes se les envía `notice` «Alumno 4 levantó la mano», como mucho uno cada 10 s por alumno.

**En la PC** (D4):
- Icono de mano con número en la lista de participantes, ordenada con las manos primero.
- Contador en la cabecera del panel.
- Menú ⋮ con «Ayudar (pedir control)» y «Bajar la mano».

---

## 8. Encuestas (`poll`)

**Mensajes:**

```ts
poll-create {question: str(300), options: array(str(100)).min(2).max(6), multi: boolean, anonymous: boolean, showResults: 'live'|'on-close'}
poll-vote   {pollId: id, choices: array(int 0..5).min(1).max(6)}
poll-close  {pollId: id}
```

**Lo que reparte el anfitrión:**

```ts
poll-state {pollId, question, options, multi, anonymous, closed: boolean, counts?: int[], voters?: {id, choices}[], total: int}
```

**Reglas:**
- Solo docentes o superiores crean y cierran encuestas.
- Al crearla, el anfitrión publica también un `msg` de clase `poll`, para que aparezca en el chat (pantalla 23).
- Un voto por persona. Si vuelve a votar, se reemplaza el anterior mientras la encuesta esté abierta.
- `counts` llega **siempre** al creador; a los demás, según `showResults`.
- `voters` llega solo al creador y solo si **no** es anónima.

---

## 9. Archivos (`file`): por el WebSocket cifrado, guardados en el anfitrión

**Decisión: el anfitrión guarda los archivos y cada uno se los pide** («almacenar y reenviar»). Los miembros no tienen conexión directa entre sí, porque la red es en estrella. Así, quien sube el archivo lo hace una sola vez y cada receptor lo descarga cuando lo pulsa.

**Límites:**
- **50 MB** por archivo y **200 MB** por reunión.
- Se guardan en una carpeta temporal del anfitrión y se borran al terminar la reunión.

**Extensiones bloqueadas** (el anfitrión las rechaza):

```
.exe .msi .bat .cmd .ps1 .vbs .js .jse .wsf .scr .com .lnk .reg .jar .hta .cpl .dll .apk
```

**Subida** (cualquier miembro con permiso de enviar `file` según la sección 6):
1. `file-offer {name: str(200), size, sha256: str(64), mime: str(100)}`.
2. El anfitrión responde `file-accept {fileId}` o `notice` con el motivo del rechazo.
3. Los trozos van como **marcos binarios** con una etiqueta nueva, siguiendo el estilo de los marcos de medios (`MEDIA_TAG = 0x01`):
   ```
   [FILE_TAG=0x02 u8][fileId u32][index u32][count u32][payload ≤ 48 KB]
   ```
4. Al completarse, el anfitrión comprueba el **SHA-256**. Luego quien lo subió envía `msg-send {body:{kind:'file', fileId}}`.

**Descarga:**
1. El receptor pulsa y envía `file-get {fileId}`.
2. El anfitrión responde `file-meta {fileId, name, size, sha256}` y los trozos.
3. El receptor verifica el hash y lo guarda en `Descargas/MirrorStudio/`.
4. **Nunca lo abre solo**: se muestra «Abrir carpeta».

**Prioridad.** Los archivos **no deben trabar el vídeo ni el control**:
- Los trozos de archivo salen por una cola aparte, de prioridad baja.
- Solo se envía un trozo si `ws.bufferedAmount` es menor de 256 KB.
- Hay como máximo 2 descargas a la vez por receptor.
- Los mensajes JSON y los marcos de medios siempre pasan primero.

---

## 10. Cámara de documentos (teléfono)

El teléfono presenta su **cámara** en lugar de su pantalla (pantalla 20). Para la sala es una presentación más.

- `present-start` añade `source: z.enum(['screen','window','camera']).default('screen')`.
- `state` añade `presenterSource`. La PC muestra «Galaxy de Caleb muestra su cámara» y no pide nada nuevo: la pista llega por el mismo transceptor `screen`.
- Sobre la cámara no hay capa de láser ni trazos (no hay ventana de PC debajo). El teléfono puede añadir zoom y linterna, que son locales.

---

## 11. Qué hay que hacer en la app de escritorio

Por prioridad. Cada fila es una rama o un PR.

| # | Trabajo | Archivos | Pruebas mínimas |
|---|---|---|---|
| 1 | Protocolo v5: `device`, `caps`, `hand`, `pairedWith` y los mensajes de las secciones 3 a 10. Generar los vectores de A4 | `packages/protocol/src/index.ts`, `protocol.test.ts`, `vectors/` | Parsear válidos e inválidos de cada mensaje |
| 2 | Regla de A5: nunca `media-mode` a quien no tiene `relay` | `meeting.ts`, `renderer/media*.ts` | Un invitado sin `relay` no recibe `media-mode` |
| 3 | **Mensajería** (sección 6): permisos, historial, `msg-mark` y `msg-show`, y el panel D3 | `meeting.ts`, `App.tsx`, `controller.ts`, `store.ts` | Con `chat:'teachers'` o `'off'` un alumno no llega a «todos»; un enlace `javascript:` se rechaza; el historial le llega a quien entra tarde; `msg-delete` solo borra lo propio salvo docentes |
| 4 | **Mano** (sección 7): fila, bajada automática y la UI de D4 | `meeting.ts`, `App.tsx` | Orden de la fila; se baja al salir y al empezar el control |
| 5 | **Archivos** (sección 9): marcos `0x02`, almacén temporal, cola de baja prioridad y la UI de descarga | `meeting-net.ts`, `meeting.ts`, nuevo `main/files.ts` | Extensión bloqueada; hash incorrecto; 50 MB; el vídeo no se corta mientras se transfiere |
| 6 | **Encuestas** (sección 8) y el modal para crearlas | `meeting.ts`, `App.tsx` | Un voto por persona; `voters` solo si no es anónima |
| 7 | **Vincular** (sección 3): ventana con `setContentProtection`, token de un solo uso y QR para unirse (D2) | `meeting.ts`, `main/index.ts`, `App.tsx` | Token caducado o reutilizado; una PC no puede reclamar |
| 8 | **Diapositivas** (sección 4): mapa de teclas y comando `F <hwnd>` en el ayudante | `input.ts`, `app-session.ts` | Solo el teléfono vinculado mueve diapositivas; nadie más |
| 9 | **Capa de láser y trazos** (sección 5) | nuevo `main/overlay.ts` + página | La capa no recibe clics; se borra al pasar de diapositiva |
| 10 | Fase 2: `slide-state` con PowerPoint por COM | `input.ts` o nuevo `main/powerpoint.ts` | Sin PowerPoint abierto no falla |

**Regla de siempre:** el anfitrión valida todos los permisos y los clientes no se autorizan solos. Cada regla de las tablas anteriores es un test en `meeting.test.ts`.

## 12. Preguntas abiertas

- **Decidido:** el chat es de grupo, como Meet o WhatsApp. Todos ven los mensajes, y todos pueden escribir y enviar archivos y enlaces, abiertamente por defecto. El docente puede limitarlo o apagarlo (`room-settings`, sección 6).
- Los 200 MB por reunión se reparten entre 35 personas. Falta decidir una cuota por persona (propuesta: 25 MB por persona).
- ¿Encuestas con respuesta correcta y puntaje? Fuera por ahora.
- ¿Guardar el historial de mensajes al terminar (exportar a .txt)? Fuera por ahora; hoy se borra todo al cerrar.
