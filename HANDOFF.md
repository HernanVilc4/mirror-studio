# Handoff — Mirror Studio (Windows, solo PC a PC en LAN)

Actualizado: 23 de noviembre de 2026 (sesión de pruebas reales Windows ↔ Ubuntu). La versión del 22 sigue abajo, desde la sección 1.

## 0. Retomar aquí (sesión del 23 de noviembre)

### Cómo arrancar
```
npm install
npm run build -w @mirror-studio/protocol   # obligatorio tras cambiar packages/protocol
npm run dev                                # electron-vite
```
- **`electron-vite dev` solo recarga en caliente el renderer.** Si cambias `src/main/*` o `src/preload/*`, hay que parar y volver a lanzar. Si no, la ventana corre código viejo, como pasó con la pantalla negra tras un `git pull`.
- Si aparece «El puerto 47800 ya está en uso», queda otra instancia de Electron viva: ciérrala.
- Para parar solo la app sin matar otros Node: termina `electron.exe` y el `node … electron-vite.js dev`.

### Entorno de prueba real
- **PC Windows 11** (`DESKTOP-A3KT7I1`, Windows en español):
  - Red usada: **Wi-Fi**, perfil Privado. IP por DHCP: 172.20.79.245 el 23-nov por la mañana y 172.20.86.233 por la tarde.
  - También tiene `Ethernet 172.22.1.43` (sin perfil), un adaptador VirtualBox `Ethernet 3 192.168.56.1` y uno WSL.
  - Regla de firewall creada a mano: `netsh advfirewall firewall add rule name="Mirror Studio" dir=in action=allow protocol=TCP localport=47800 profile=private,domain`.
- **PC Ubuntu** (`luck-acer`, 172.20.79.240), en la misma Wi-Fi. Hace de anfitrión o de invitado. Se actualiza con `git pull`.
- Ya funciona entre ambas: unirse por IP y código, presentar, pedir y dar control.

### Hecho hoy (commits en `main`: f713173, 7ab1fc5, 99b613e, 693db17 y lo pendiente de abajo)
- **Permisos de Electron** (`main/index.ts`, `setPermissionRequestHandler`): se permiten `display-capture`, `media`, `clipboard-sanitized-write` y `fullscreen`.
  - Chromium pide `media` antes de `getDisplayMedia`. Al negarlo, salía `NotAllowedError: Permission denied`.
- **Interfaz de red** (`network.ts`): los adaptadores de VM se detectan también por el prefijo de la MAC (VirtualBox, VMware, Hyper-V). Antes se anunciaba 192.168.56.1.
- **Firewall** (`parseFirewall`): entiende la salida de `netsh` en español y con acentos rotos por la página OEM, y acepta reglas por puerto. Antes siempre decía «falta la regla».
- **Vídeo** (`media.ts`, `videoLimits`):
  - Bitrate y fps se reparten según el número de espectadores: 12 Mbps y 30 fps con 1, hasta 2,5 Mbps y 15 fps con 35. Presupuesto de unos 80 Mbps de salida del anfitrión.
  - Captura hasta 1440p, con `degradationPreference: maintain-resolution`.
- **Control remoto** (`input.ts`):
  - El helper de PowerShell es DPI-aware.
  - Antes de cada pulsación vuelve a mover el cursor a la última posición y espera 40 ms, para que los botones de la barra de título (minimizar, cerrar) registren el hover.
  - **Sin confirmar** que esto arregle los clics que fallaban.
- **Estados** (`controller.ts`):
  - La captura tiene dueño (`screenKind`: `present` o `control`).
  - `present-start` sin confirmación caduca a los 6 s.
  - Presentar termina los controles que yo ejerzo.
- **Interfaz**:
  - Barra de título propia (`titleBarStyle: 'hidden'` + `titleBarOverlay`) y portada rediseñada con animación del logo.
  - Botones con iconos animados, sin flechas de texto. Copiar IP, código o ambos solo con icono.
  - Panel de participantes plegable.
  - Pantalla completa del escenario y de la vista de control.
  - Barra flotante «Controlando X» fuera de la zona que captura teclado y ratón.
  - El presentador ve su propia presentación, con un botón de ojo para ocultarla y evitar el espejo infinito. La preferencia se guarda en `localStorage`.

### Documentos (23-nov)
- `docs/GUIA-PRUEBAS-LAN.md`: guía de pruebas generales en red local (29 pruebas). La sección 5.4 cubre los escenarios que fallaban.
- `docs/GUIA-DOCUMENTACION.md`: cómo un compañero hace los 3 documentos (Para ejecutar, Manual de uso, Código fuente) **copiando las plantillas `.docx` de PushProMaster que están en `docs/`**, con el mismo formato y solo el contenido adaptado.
- Firewall de la PC Windows de pruebas: además de la regla del puerto, hay una regla por programa `Mirror Studio (dev)` para `node_modules\electron\dist\electron.exe` (TCP y UDP, Privada y Dominio).

### Último arreglo (subido el 23-nov, sin probar aún entre dos PCs)
- **Fallo reproducido:** A presenta, B le pide control, B deja el control → A queda «presentando» sin enviar imagen. B ve el último fotograma congelado, con la barra roja.
  - **Causa:** al aceptar el control, la captura de A se reemplaza por la de pantalla completa, de tipo `control`. Al terminar, esa captura se soltaba aunque A seguía siendo presentador.
  - **Arreglo:** `endControlCapture()`. Si sigo presentando, la captura vuelve a ser `present` y se recaptura la fuente que había elegido (`presentSource`: ventana y audio).
  - **No probado entre dos PCs.**
- **Todos pueden presentar:** `canPresent` devuelve `true` para cualquier rol. Sigue sin poder quitarle la presentación alguien de rango menor a uno de rango mayor. Perder un rol ya no corta la presentación. Tests actualizados.
- Tests: protocolo 22 ✓, escritorio 63 ✓, typecheck ✓.

### Próximo paso
1. Subir lo pendiente. Luego, en el Ubuntu, `git pull`.
2. Repetir el escenario del fallo: A presenta una **ventana** → B pide control → A acepta → B deja el control. Comprobar:
   - B vuelve a ver la ventana de A, no la pantalla entera.
   - A ve su espejo.
   - La barra roja de A desaparece.
3. Probar los clics remotos sobre minimizar y cerrar. Si siguen fallando, añadir un `SetCursorPos` antes de pulsar, o mover el cursor por fuera y luego dentro del botón.
4. Confirmar en Linux que la barra de título propia muestra los botones del sistema (`titleBarOverlay` en Linux).
5. Revisar la calidad de vídeo percibida con 1 espectador y medir la CPU del anfitrión con varios.
6. Pendientes de la sección 7 y las 5 vulnerabilidades de `npm audit`.

Nota: la sección 3 habla de «SFU en el anfitrión», pero lo implementado es el concentrador con `replaceTrack` descrito en la fase 3. No hay SFU.

## 1. Visión

Mirror Studio es una alternativa local a Google Meet para laboratorios y aulas. Funciona **sin Internet**, solo entre PCs Windows 10/11 conectadas por **cable Ethernet** a la misma red.

Casos de uso:
- **Reunión o clase:** una persona crea una sesión; el resto se une desde la lista de sesiones detectadas o con IP y código.
- **Presentar pantalla:** cualquiera comparte su pantalla o una ventana, y todos la ven (desde el 23-nov; antes solo docentes y administradores).
- **Control remoto de PC:** un docente o administrador pide controlar la PC de un participante. El participante acepta o rechaza, y puede revocar en cualquier momento.
- **Roles:** el creador es administrador y puede asignar o retirar los roles de docente y administrador.

### Fuera de alcance
| Tema | Motivo |
|---|---|
| **Android y móviles** | En los laboratorios no se puede exponer el WiFi a la red Ethernet de las PCs. Se retira todo lo móvil del plan, incluidas las APK, el QR y el servicio de accesibilidad. |
| **Micrófono y voz** | Todos están en el mismo laboratorio y se oyen entre sí. Lo único que viaja por red es el sonido de la PC del presentador. |
| Cámara, grabación, Internet/NAT, scrcpy | No son necesarios para la primera entrega. |

### Metas
- Hasta **35 participantes** por sesión. Es una meta, no una promesa: se anuncia solo si las mediciones de carga la confirman.
- **Una persona presenta a la vez.**
- Instalación sencilla (instalador) y una guía de firewall de una página.

## 2. Modelo de roles y permisos

| Rol | Cómo se obtiene | Puede |
|---|---|---|
| **Creador** | Quien crea la sesión. Es administrador permanente. | Todo lo del administrador, y no se le puede retirar el rol. Al cerrarse la sesión se pierde el anfitrión. |
| **Administrador** | Solo lo asigna el creador. | Expulsar (a docentes y participantes), asignar o retirar docentes, presentar, pedir control. |
| **Docente** | Lo asigna el creador o un administrador. | Presentar (con el sonido de su PC), pedir control. |
| **Participante** | Se une a la sesión. | Presentar (si nadie de rango mayor presenta), ver y oír la presentación, aceptar o rechazar solicitudes de control. |

Reglas que no se negocian:
1. **El anfitrión valida todos los permisos.** Ningún cliente se autoriza a sí mismo.
2. **Control de PC:** el destinatario acepta cada solicitud por separado. Mientras dura, ve un indicador persistente y puede revocarla. Al desconectarse el destinatario o el controlador, o al terminar la sesión, el permiso se revoca y se liberan teclas y botones retenidos.
3. **Un permiso de control no se hereda.** Si cambia el docente, hay que pedirlo de nuevo.

## 3. Arquitectura propuesta

```
        RED LOCAL ETHERNET (sin Internet)

  ┌────────────────────────────────┐
  │ PC ANFITRIÓN (creador)         │
  │  · Señalización WebSocket      │   ┌───────────────┐
  │  · Registro de roles/permisos  │◄──┤ PC Participante│
  │  · Concentrador (pantalla + audio de la PC) │ (Electron)    │
  │  · Anuncio de sesión (mDNS)    │   └───────────────┘
  └──────────────┬─────────────────┘   ┌───────────────┐
                 │  WebRTC (SRTP)  ◄───┤ PC Docente    │
                 │                     │ presenta/ctrl │
                 │                     └───────────────┘
                 ▼
          hasta 35 participantes
```

- **Electron + React** como ahora. El anfitrión corre la señalización y la SFU dentro del mismo proceso o como proceso hijo.
- **Descubrimiento:** anuncio en la LAN por mDNS o UDP broadcast. Respaldo: **IP + código** manual. Muchos laboratorios segmentan por VLAN y el broadcast no cruza, así que el respaldo manual es obligatorio, no opcional.
- **SFU en el anfitrión** (compatible con Windows) para llegar a 35. Con malla P2P no se llega. Hay que medir CPU, memoria y red antes de comprometer la cifra.
- **Selección de IP:** con varias interfaces (Ethernet, VPN, Hyper-V, WiFi apagado) hay que elegir la interfaz correcta para anunciar. Se muestra en preparación y es editable.
- **Entrada nativa de Windows** para el control: `SendInput` desde un módulo nativo o desde un helper. La opción concreta se decide en la fase 4.
- **Seguridad:** el token actual viaja en claro por WebSocket sin TLS, y la firma HMAC no protege contra quien observe la red. **No se puede presentar el código actual como autenticación segura.** La fase 2 diseña y prueba un intercambio autenticado antes de habilitar reuniones. En un laboratorio hay alumnos con capacidad de capturar tráfico.

## 4. Pantallas

### 4.1 Inicio

```
┌──────────────────────────────────────────────────────────┐
│  Mirror Studio                              ⚙  Mi nombre │
├──────────────────────────────────────────────────────────┤
│                                                          │
│   [ + Crear reunión ]        [ → Unirse con IP y código ]│
│                                                          │
│   Reuniones detectadas en tu red                         │
│   ┌────────────────────────────────────────────────────┐ │
│   │ ● Clase de Redes – Lab 3   Prof. Ruiz   12 pers.   │ │
│   │                                          [ Unirse ]│ │
│   │ ● Soporte técnico          Admin          3 pers.  │ │
│   │                                          [ Unirse ]│ │
│   └────────────────────────────────────────────────────┘ │
│                                                          │
│   Estado: Ethernet 192.168.10.24 ✓  Firewall: ✓          │
└──────────────────────────────────────────────────────────┘
```
- **Estado vacío:** «No se detectaron reuniones. Si tu red está dividida en VLAN, usa *Unirse con IP y código*.»
- **Pie de estado:** interfaz de red usada y estado del firewall, con un enlace a la guía.

### 4.2 Preparación

```
┌──────────────────────────────────────────────────────────┐
│  Clase de Redes – Lab 3                                  │
├──────────────────────────────────────────────────────────┤
│  Tu nombre   [ Ana Pérez                 ]               │
│  Código      [ XXXX-XXXX ]   (solo al unirse)            │
│                              [ Cancelar ] [ Entrar ]     │
└──────────────────────────────────────────────────────────┘
```

### 4.3 Sala

```
┌──────────────────────────────────────────────────────────────────┐
│ Clase de Redes – Lab 3    Código 483 920     ● 12 pers.   ⏱ 24:10│
├───────────────────────────────────────────────┬──────────────────┤
│                                               │ Participantes    │
│                                               │ ★ Ana (creadora) │
│        PRESENTACIÓN DE PANTALLA               │ 🎓 Prof. Ruiz 🔊 │
│        (Prof. Ruiz)                           │ ○ Luis        🔇 │
│                                               │ ○ María       🔊 │
│        ─ sin presentación ─                   │ ○ …              │
│        si nadie presenta, se muestran         │   [ ⋮ acciones ] │
│        los participantes en cuadrícula        │                  │
│                                               │ Controlando:     │
│                                               │ Prof.→Luis ⛔Fin │
├───────────────────────────────────────────────┴──────────────────┤
│            ( ⎚ Presentar )   ( ⌖ Control )   ( ✆ Salir )         │
└──────────────────────────────────────────────────────────────────┘
```
- **Presentar:** elegir pantalla completa o una ventana, con la casilla «Compartir también el sonido de esta PC» (Windows). Si otro ya presenta, un docente o administrador debe confirmar el reemplazo.
- **⋮ Acciones** (según el rol de quien actúa): hacer docente, hacer administrador, retirar rol, expulsar, pedir control.
- **Panel «Controlando»:** muestra quién controla a quién, con botón de revocar.

### 4.4 Consentimiento y control activo

```
 En la PC de Luis (destinatario)
┌────────────────────────────────────────────┐
│  🖱 Solicitud de control                   │
│  Prof. Ruiz quiere controlar tu PC.        │
│  Podrá mover el ratón y usar el teclado.   │
│  Puedes cancelarlo cuando quieras.         │
│             [ Rechazar ]   [ Permitir ]    │
└────────────────────────────────────────────┘

 Mientras dura (siempre visible, sobre todas las ventanas):
┌────────────────────────────────────────────────────────┐
│ ⚠ Prof. Ruiz controla esta PC        [ Detener control]│
└────────────────────────────────────────────────────────┘
```
- Atajo de teclado de emergencia, por ejemplo **Ctrl+Alt+Esc** de la app, para revocar al instante.
- La barra indicadora **no se puede cerrar** mientras el control esté activo.

### 4.5 Accesibilidad
Navegación completa con teclado, orden de foco definido, etiquetas para lectores de pantalla, escalado de Windows (100/125/150 %), y contraste suficiente en el indicador de control.

## 5. Plan por fases y estado

Leyenda: ✅ hecho y probado · 🟡 hecho, falta validar en Windows real · ⬜ pendiente.

### Fase 1 — Línea base
- ✅ En Linux: instalar, 59 + 22 pruebas, typecheck, build, y arranque real de dos instancias de Electron.
- ⬜ Repetir en **Windows 10/11** y probar **dos PCs reales** por Ethernet (descubrimiento, firewall, desconexión).

### Fase 2 — Sesiones y emparejamiento autenticado
- ✅ Sesión con nombre, código de 8 caracteres, lista y roles; el anfitrión valida todo; al irse el creador termina la reunión.
- ✅ Handshake: X25519 + código estirado con PBKDF2 (200 000 iteraciones) + confirmación HMAC; canal AES-256-GCM con contador. Probado: el código no aparece en la red, no se reutiliza una captura, un impostor es rechazado, bloqueo de 1 min tras 5 fallos.
- ⚠ Límite conocido: sin librería PAKE (no se pudo instalar `spake2`), un atacante **activo** que se ponga en medio puede probar códigos sin conexión; cada intento cuesta una derivación PBKDF2 y el código tiene 40 bits. Un observador **pasivo** no puede. Reemplazar por SPAKE2 u OPAQUE si el laboratorio tiene alumnos que hagan ARP spoofing.
- ✅ Código de Android y QR retirado del producto; `apps/android` y las dos APK se **borraron** del disco (confirmado por el usuario; no había git).

### Fase 3 — Audio de la PC y presentación
- ✅ Presentación: un docente presenta y el anfitrión recibe vídeo 1920×1080 (verificado en Linux con Electron real).
- ✅ **Audio de la PC al presentar** (sin micrófono: todos están en el mismo laboratorio). El presentador comparte la imagen y, con la casilla «Compartir también el sonido de esta PC», el audio del sistema (captura *loopback*, **solo Windows**). Verificado en Linux con una pista de audio sintética en lugar de la captura real: llega del invitado al anfitrión y del anfitrión al invitado, el presentador no recibe su propio sonido, y el sonido se corta al dejar de presentar. **Falta probar la captura real del sonido del sistema en Windows.**
- ⚠ **Esto no es una SFU.** El concentrador del anfitrión reenvía imagen y audio con `replaceTrack`, pero Chromium **re-codifica el vídeo una vez por espectador** (limitado a 2,5 Mbps y 15 fps).
- Mediciones hechas (en una PC de desarrollo de **12 núcleos**, Linux, sin GPU):
  - Plano de control, 35 sockets reales con PBKDF2 de producción (`apps/desktop/scripts/load.test.ts`): **entran los 35 en 146 ms; un cambio de estado llega a todos en 3 ms; +16 MB.**
  - **Vídeo**, 35 emisores WebRTC reales a 1080p con los límites del concentrador (`apps/desktop/scripts/video-load`, incluye también la decodificación de los 35 receptores en el mismo proceso): **5 espectadores ≈ 3 % de un núcleo, 15 ≈ 14 %, 35 ≈ 37 %; 15 fps sostenidos en los tres casos.** El contenido es texto desplazándose y un bloque en movimiento; una presentación con vídeo a pantalla completa costará bastante más.
  - Limitaciones de esas cifras: loopback sin red real, 12 núcleos (un PC de laboratorio puede tener 4), y sin el audio.
- ⬜ Repetir `scripts/video-load` en una **PC típica del laboratorio** y con 35 PCs reales por Ethernet (el tráfico es ~2,5 Mbps × 35 ≈ 88 Mbps de salida del anfitrión: cabe en Gigabit, **no en 100 Mbps**). Si no alcanza: bajar a 10 fps / 1,2 Mbps, o cambiar a una SFU real.

### Fase 4 — Control de PC
- ✅ Solicitud, consentimiento por solicitud, un controlador por PC, límite de 400 eventos/s, revocación por cualquiera de las partes, por pérdida de rol, desconexión o fin de sesión. Las teclas y botones retenidos se liberan en todos esos casos (probado con cable desconectado).
- ✅ Barra roja siempre visible en ventana aparte y atajo global **Ctrl+Alt+Esc**; foco inicial en «Rechazar».
- 🟡 Inyección con `SendInput` mediante un PowerShell persistente (sin dependencias nativas). **Escrito contra la API documentada, nunca ejecutado en Windows.**
- ⚠ Mientras una PC es controlada comparte su **pantalla principal completa** (las coordenadas se normalizan sobre ella). Si además presentaba una ventana, pasa a mostrar la pantalla entera.
- ⚠ Solo la pantalla principal; no hay soporte multi-monitor ni se compensa el escalado de Windows más allá de coordenadas normalizadas.
- ⬜ Probar ratón, teclado y revocación entre dos PCs Windows.

### Fase 5 — Interfaz
- ✅ Inicio, preparación, sala, selector de pantalla/ventana, menú de acciones por rol, consentimiento, estados vacíos y errores con instrucción de recuperación; etiquetas ARIA, foco gestionado, cierre con Esc.
- ⬜ Revisar con lector de pantalla y escalado 125/150 % en Windows.

### Fase 6 — Entrega
- ✅ **Paquete portable de Windows** (no necesita `electron-builder`): `npm run dist:portable` genera `release/Mirror-Studio-win32-x64.zip` (137 MB; Electron 39.8.10 oficial con checksum verificado + la app compilada + `ws`). Se descomprime en cualquier carpeta de Windows y se ejecuta `Mirror Studio.exe`; no instala nada ni crea la regla de firewall (ejecutar el comando de `FIREWALL.md` una vez como administrador). Comprobado: es un `.exe` PE de Windows x64, el zip está íntegro y la app solo requiere `electron`, módulos de Node y `ws` (incluido). **No se pudo ejecutar aquí (Linux).**
- ✅ **Instalador construido**: `npm run dist -w @mirror-studio/desktop` → `release/Mirror Studio Setup 0.1.0.exe` (NSIS x64, 98 MB, instalación por máquina, con icono). Se construyó desde Linux sin `wine`. `electron-builder` 26.18 instalado; versión de Electron fijada en `electron-builder.yml` (`electronVersion: 39.8.10`, debe coincidir con la instalada). `build/installer.nsh` añade la regla de firewall (Privado y Dominio) al instalar y la quita al desinstalar. **Sin ejecutar nunca en Windows**, y no pude leer la macro del firewall dentro del binario compilado: confirmar tras instalar con `netsh advfirewall firewall show rule name="Mirror Studio"`.
- ⚠ Sin firma de código (no hay certificado): Windows SmartScreen mostrará un aviso en las PCs. Para firmar, definir `CSC_LINK` y `CSC_KEY_PASSWORD` al construir.
- ✅ Guía de firewall: `docs/FIREWALL.md`.
- ⬜ Instalación en equipo limpio, firma de código (sin certificado las PCs verán el aviso de SmartScreen), y carga representativa de 35 personas.

## 6. Estado actual del código

- Implementado según la sección 5. 81 pruebas automáticas (protocolo 22, escritorio 59) más una prueba con dos instancias reales de Electron (crear, código incorrecto, unirse, rol, presentar, consentimiento).
- Todo se verificó en **Linux**. **Nada se ha ejecutado en Windows ni entre dos PCs físicas.**
- Android: código, QR, `apps/android` y las dos APK eliminados (confirmado por el usuario).
- `npm install` informa de 5 vulnerabilidades (2 críticas, 2 altas); revisarlas antes de la entrega.
- Un fallo real encontrado y corregido por la prueba de extremo a extremo: tras un código incorrecto la interfaz volvía al inicio y perdía el mensaje (ahora hay prueba de regresión).

## 7. Decisiones tomadas y pendientes

**Tomadas:**
- Solo PC a PC en LAN Ethernet; Android queda fuera.
- Objetivo: reemplazar a Meet en laboratorios, con presentación (imagen y sonido de la PC), roles y control de PC. Sin micrófono.
- El control de PC y los roles de docente y administrador entran en la primera entrega.

**Pendientes (a confirmar con el usuario):**
- Versión mínima de Windows y si los laboratorios usan perfil de red «Privada» o «Dominio».
- Si los equipos tienen VLAN que bloqueen el broadcast (determina si el respaldo manual es la vía principal).
- Método de distribución (instalador `.exe`, MSI o red del centro) y si hay certificado de firma.
- Si al menos dos PCs Windows estarán disponibles para pruebas.

## 8. Puntos de entrada

- `README.md`: arquitectura, comandos y estado. `docs/FIREWALL.md`: guía para TI.
- `packages/protocol/src/index.ts` (mensajes, roles) y `node.ts` (handshake y cifrado).
- `apps/desktop/src/main/`: `meeting.ts`, `meeting-net.ts`, `app-session.ts`, `input.ts`, `network.ts`, `index.ts`.
- `apps/desktop/src/renderer/src/`: `App.tsx` (vistas), `controller.ts`, `media.ts`, `store.ts`.
