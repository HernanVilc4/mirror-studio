# Guía de pruebas en red local — Mirror Studio

Versión de la app: rama `main`, 23 de noviembre de 2026. Esta guía sirve para que cualquier integrante levante Mirror Studio en su PC y compruebe que todo funciona entre varias PCs de la misma red.

## 1. Introducción

Mirror Studio permite crear una reunión en una PC (el **anfitrión**) y que otras PCs de la misma red se unan sin Internet. Dentro de la reunión se puede:
- presentar la pantalla o una ventana, con el sonido de la PC
- pedir el control remoto de otra PC, con su permiso
- gestionar roles

En esta guía:
- **PC A** = anfitrión, quien crea la reunión.
- **PC B** = invitado, quien se une. Si hay más PCs, son **C**, **D**…

> La IP de A **puede cambiar** de un día a otro (la Wi-Fi la asigna por DHCP). Usa siempre la que aparece arriba en la sala de A, junto al código de 8 caracteres. En los ejemplos de abajo, `172.20.86.233` es solo un ejemplo.

## 2. Requisitos del sistema

| Requisito | Detalle |
|---|---|
| Sistema | Windows 10/11 (el control remoto solo funciona en Windows). Ubuntu sirve para presentar y ver. |
| Red | Todas las PCs en la **misma red local** (misma Wi-Fi o mismo switch/cable). No hace falta Internet para usar la app. |
| Perfil de red en Windows | **Privada**: Configuración → Red e Internet → la red → *Perfil de red: Privada*. |
| Node.js | 22 LTS o superior: https://nodejs.org. Se usó Node 24. |
| Git | https://git-scm.com |
| Internet | Solo para instalar: `npm install` descarga Electron. |

## 3. Instalación y ejecución

1. Clonar y entrar a la carpeta:
   ```
   git clone https://github.com/HernanVilc4/mirror-studio.git
   cd mirror-studio
   ```
   Si ya lo tenías: `git pull`.
2. Instalar dependencias y compilar el protocolo:
   ```
   npm install
   npm run build -w @mirror-studio/protocol
   ```
3. Abrir la app:
   ```
   npm run dev
   ```
   Se abre la ventana **Mirror Studio**, con el logo animado.
4. **Firewall (solo la PC que será anfitrión, una vez).** Abre PowerShell **como administrador**, entra a la carpeta del proyecto y ejecuta:
   ```
   netsh advfirewall firewall add rule name="Mirror Studio (dev)" dir=in action=allow program="$PWD\node_modules\electron\dist\electron.exe" enable=yes profile=private,domain
   ```
   La regla es por programa porque la imagen y el sonido usan UDP con puertos variables.
5. Comprueba el pie de la pantalla de inicio:
   - **Red** debe mostrar la IP real (por ejemplo 172.20.x.x o 192.168.x.x), no una de VirtualBox (192.168.56.x).
   - **Firewall** debe decir *permitido*.

> Si cambias código de `apps/desktop/src/main` o `preload`, cierra la app (Ctrl+C en la terminal) y vuelve a ejecutar `npm run dev`. Solo la interfaz se recarga sola.

## 4. Preparar la red (antes de probar)

1. En la PC A, ejecuta `ipconfig` y anota la IPv4 del adaptador conectado (Wi-Fi o Ethernet).
2. En la PC A, pulsa **Crear reunión** y luego **Crear y entrar**.
3. Desde la PC B, comprueba que llega al anfitrión. En PowerShell:
   ```
   Test-NetConnection 172.20.86.233 -Port 47800
   ```
   Cambia la IP por la de A. Debe salir `TcpTestSucceeded : True`. En Ubuntu: `nc -zv 172.20.86.233 47800`.
4. Si sale `False`, revisa la sección 7 antes de seguir.

## 5. Flujo de pruebas paso a paso

Marca cada prueba con ✅ o ❌ y anota qué viste. Haz primero las **básicas**; si fallan, las demás no tienen sentido.

### 5.1 Conexión

| # | Paso | Resultado esperado | ✅/❌ |
|---|---|---|---|
| 1 | B abre la app y mira *Reuniones en tu red* | Aparece la reunión de A con su IP y un punto verde | |
| 2 | B pulsa **Unirse** (o *Unirse con IP y código* y escribe la IP de A) | Pide el código | |
| 3 | B escribe un código **incorrecto** | Mensaje claro de código incorrecto; no entra | |
| 4 | B escribe el código correcto (botón 🔗 de A para copiarlo) | B entra; ambos ven «2 personas» | |
| 5 | En A, botones de copiar IP, código y 🔗 (ambos), y pegar con Ctrl+V | Copia el valor; el icono cambia a ✓ con un anillo | |
| 6 | Botón 👥 arriba a la derecha | El panel de participantes se oculta y vuelve a aparecer | |

### 5.2 Presentar

| # | Paso | Resultado esperado | ✅/❌ |
|---|---|---|---|
| 7 | B (participante, sin rol) pulsa **Presentar** → *Pantalla principal* | A ve la pantalla de B. **Todos pueden presentar** | |
| 8 | En B, mirar su propia sala | B ve lo que presenta. El botón 👁 lo oculta para evitar el espejo infinito; *Ver lo que presento* lo vuelve a mostrar | |
| 9 | En A, pasar el ratón sobre la presentación → botón ⛶ | Pantalla completa; Esc o el botón vuelven a la pestaña | |
| 10 | B presenta una **ventana** concreta con «Compartir también el sonido de esta PC» y reproduce un vídeo | A ve solo esa ventana y **oye** el sonido | |
| 11 | A (creador) presenta mientras B presenta | A toma la presentación (rango mayor) | |
| 12 | B intenta presentar mientras A presenta | B no puede quitársela; recibe aviso | |
| 13 | El presentador pulsa **Detener** | Todos vuelven a la cuadrícula de participantes | |

### 5.3 Control remoto (la PC controlada debe ser Windows)

| # | Paso | Resultado esperado | ✅/❌ |
|---|---|---|---|
| 14 | A: «⋮» sobre B → *Pedir control de su PC* | En B aparece el diálogo con el foco en **Rechazar** | |
| 15 | B pulsa **Rechazar** | A recibe el aviso; no hay control | |
| 16 | Repetir y B pulsa **Permitir** | B muestra la barra roja arriba; A ve la pantalla de B y la barra flotante «Controlando B» | |
| 17 | A mueve el ratón, hace clic, escribe y usa la rueda en B | Todo cae donde apunta A | |
| 18 | A pulsa **minimizar**, **maximizar** y **cerrar** de una ventana de B (por ejemplo el Bloc de notas) | Responden al primer clic | |
| 19 | A usa ⛶ en la barra flotante | La vista de control pasa a pantalla completa | |
| 20 | En B, **Ctrl+Alt+Esc** | El control se corta al instante; la barra roja desaparece | |
| 21 | Repetir el control y que A pulse ✕ en la barra flotante | Igual que la 20, desde el lado de A | |

### 5.4 Escenarios que antes fallaban (prioridad)

| # | Paso | Resultado esperado | ✅/❌ |
|---|---|---|---|
| 22 | B presenta una **ventana** → A le pide control → B acepta → A **deja el control** | A vuelve a ver **la ventana** de B (no congelada); B sigue viendo su espejo; la barra roja de B desaparece | |
| 23 | A controla a B → A deja el control → **en seguida** A pulsa Presentar | A presenta normal; no queda nada «trabado» | |
| 24 | A controla a B → A pulsa Presentar sin dejar el control | El control termina solo y A presenta | |
| 25 | Pulsar Presentar y que el anfitrión no responda (desconectar la red de B un momento) | A los 6 s, aviso «El anfitrión no confirmó…»; B no queda a medias | |

### 5.5 Salida y fallos de red

| # | Paso | Resultado esperado | ✅/❌ |
|---|---|---|---|
| 26 | B pulsa **Salir** | B vuelve al inicio; A ve «1 persona» | |
| 27 | Mientras A controla a B, mantener Shift y **desconectar la red de A** | En B no queda ninguna tecla pegada; la barra roja desaparece | |
| 28 | A pulsa **Terminar** | Todos vuelven al inicio con un aviso | |
| 29 | Con 3 o más PCs: una presenta y las demás miran | Todas ven la presentación; anotar si se ve fluida | |

### 5.6 Control que deja de responder (detección y recuperación)

Mientras A controla a B, B le informa cada 2 s cómo va el control. Si algo falla, A ve un aviso ámbar bajo la barra «Controlando B». Si el problema se puede arreglar solo, el control se reinicia: hasta 3 veces seguidas, como mucho una cada 10 s. El botón ↻ de la barra hace lo mismo a mano.

| # | Paso | Resultado esperado | ✅/❌ |
|---|---|---|---|
| 30 | A controla a B durante 2 minutos: clics, rueda arriba y abajo, escribir | Nunca deja de responder; sin avisos | |
| 31 | En B abrir el **Administrador de tareas** (o una terminal «como administrador») y dejarlo delante | A ve «Windows bloquea el control: … ventana de administrador delante (Taskmgr)». La barra roja de B dice lo mismo. Al cambiar de ventana en B, el aviso de A desaparece y el control sigue | |
| 32 | En B pulsar **Win+L** (bloquear) y volver a entrar | A ve «…muestra una pantalla protegida de Windows…». Al desbloquear, el control vuelve sin pedirlo de nuevo (si la imagen quedó congelada, se recupera sola o con ↻) | |
| 33 | En B, Administrador de tareas → Detalles → finalizar los `powershell.exe` de Mirror Studio (el ayudante de entrada) | Como mucho 2 a 4 s de «Reiniciando el control…» y vuelve a funcionar solo. El cursor no salta a la esquina | |
| 34 | A pulsa ↻ en la barra flotante | La imagen parpadea un momento y el control sigue normal | |
| 35 | Con una PC sin actualizar, intentar unirse | Mensaje «versiones distintas de Mirror Studio»; actualizar ambas | |

## 6. Qué anotar si algo falla

- Número de prueba, qué PC (A o B) y sistema (Windows 10/11 o Ubuntu).
- **Captura de pantalla de las dos PCs** en el momento del fallo.
- La IP y el estado del firewall que muestra el pie de la pantalla de inicio.
- El texto de la terminal donde corre `npm run dev` (copiar las últimas líneas).
- Resultado de `Test-NetConnection IP-DE-A -Port 47800`.

## 7. Errores comunes y soluciones

| Síntoma | Causa probable | Solución |
|---|---|---|
| B no ve la reunión en la lista | Redes distintas, VLAN o aislamiento de clientes en la Wi-Fi | Usar *Unirse con IP y código*. Si `Test-NetConnection` da `False`, revisar el firewall de A o usar otra red/cable |
| `TcpTestSucceeded : False` | Falta la regla de firewall en A o la red está como **Pública** | Paso 4 de la sección 3 y perfil **Privada** |
| Entra, pero no se ve la pantalla ni se oye | UDP bloqueado | La regla debe ser **por programa** (`electron.exe`), no solo el puerto 47800 |
| «El puerto 47800 ya está en uso» | Otra ventana de Mirror Studio abierta en esa PC | Cerrarla (o cerrar `electron.exe` en el Administrador de tareas) |
| La IP mostrada es 192.168.56.x | Adaptador de VirtualBox | Actualizar (`git pull`); la app ya los ignora. Si sigue, desactivar el adaptador virtual |
| «No se pudo capturar la pantalla: NotAllowedError» | Versión vieja | `git pull` y reiniciar `npm run dev` |
| Pantalla negra tras `git pull` | La app siguió con el código anterior | Cerrar la app y volver a ejecutar `npm install` y `npm run dev` |
| «Código incorrecto» repetido | Bloqueo de 1 min tras 5 intentos | Esperar un minuto; el código no lleva 0, 1, I ni O |
| Los clics remotos caen desplazados | Escalado de Windows (125 %/150 %) o varios monitores | Anotar el escalado y la resolución de B; usar la pantalla principal |
| «Versiones distintas de Mirror Studio» al unirse | Una PC no se actualizó | `git pull` en todas y **cerrar y volver a abrir** `npm run dev` (no basta con recargar) |
| El control deja de responder a los pocos segundos | En B: la app no se reinició tras `git pull`, o hay una ventana de administrador o un aviso de Windows delante | Leer el aviso ámbar en A; reiniciar la app en B; cambiar de ventana en B. Anotar las líneas `[input] …` de la terminal de B |

## 8. Consejos de buen uso

- Haz `git pull` en **todas** las PCs antes de probar: mezclar versiones da fallos falsos.
- Prueba primero con 2 PCs y la sección 5.1. Añade más PCs solo cuando eso funcione.
- Usa cable Ethernet cuando puedas: la Wi-Fi de instituciones suele aislar equipos o tener poco ancho de banda.
- Cierra VPN y máquinas virtuales durante la prueba.
- Reporta un fallo por mensaje, con su número de prueba y las capturas de ambas PCs.
