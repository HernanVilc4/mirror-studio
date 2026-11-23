<!--
Texto del «Manual de Uso - Mirror Studio». Lo lee docs/tools/armar_manual.py para armar el Word.
Cada bloque separado por una línea en blanco es un párrafo; las líneas de un mismo bloque van en el
mismo párrafo, separadas por un salto de línea, como en la plantilla. **Texto** marca los nombres de
botones y mensajes de la app: en el Word salen entre comillas, sin negrita.
[captura NN-nombre] es la captura docs/manual/anotadas/NN-*.png que va debajo del párrafo anterior.
Los números entre paréntesis, como (1), son las marcas de esa captura.
-->

# Manual de Uso - Mirror Studio

## 1. Introducción

Mirror Studio (en la ventana del programa el nombre aparece escrito junto: MirrorStudio) es una aplicación de escritorio para hacer reuniones entre computadoras (PCs) conectadas a la misma red local, por ejemplo las de un aula o un laboratorio, sin necesidad de Internet. Una persona crea la reunión en su PC (el anfitrión) y las demás se unen desde las suyas. Dentro de la reunión, cualquiera puede presentar su pantalla o una ventana, con el sonido de la PC, y el creador, un administrador o un docente puede pedir el control del ratón y el teclado de otra PC, que solo se entrega si su dueño lo permite. Cada persona tiene un rol, de mayor a menor: creador (quien abrió la reunión), administrador, docente y participante; el rol decide quién puede pedir el control, cambiar roles o expulsar. Es ideal para aulas y laboratorios.

## 2. Requisitos del Sistema

- Windows 10 u 11 de 64 bits en cada PC (Ubuntu puede ejecutar el código fuente, pero el control remoto y el sonido de la PC solo funcionan en Windows)
- Todas las PCs conectadas a la misma red local: de preferencia por cable Ethernet; también la misma Wi-Fi o un mismo hotspot
- Git instalado en el sistema (https://git-scm.com), solo si se ejecuta el código fuente
- Node.js versión 22 o superior, de preferencia la LTS (versión de soporte prolongado) (https://nodejs.org), solo si se ejecuta el código fuente
- Conexión a Internet solo para instalar; la aplicación funciona sin Internet

## 3. Instalación

- Descarga Mirror-Studio-win32-x64.zip desde https://github.com/HernanVilc4/mirror-studio/releases/tag/v0.1.0, extráelo completo (clic derecho → **Extraer todo**) y haz doble clic en Mirror Studio.exe. También puedes usar el instalador Mirror-Studio-Setup-0.1.0.exe, aunque Windows 11 lo bloquea si tiene activado el Control inteligente de aplicaciones. Los pasos detallados están en el documento «Para ejecutar».
- Si Windows muestra el aviso de SmartScreen, pulsa **Más información** y luego **Ejecutar de todos modos**.
- Si deseas usar el código fuente:
  1. Instala Git y Node.js.
  2. Descarga el proyecto con: git clone https://github.com/HernanVilc4/mirror-studio.git y entra a su carpeta con: cd mirror-studio
  3. Instala las dependencias con: npm install y luego npm run build -w @mirror-studio/protocol
  4. Ejecuta la aplicación con: npm run dev
- Permite Mirror Studio en el firewall de Windows (la protección que bloquea las conexiones que llegan de otras PCs) una sola vez; es imprescindible en la PC que creará la reunión. El comando aparece en **Ayuda de red**, en la pantalla de inicio, y se pega en PowerShell abierto como administrador (clic derecho → **Ejecutar como administrador**).

## 4. Interfaz Principal

La ventana principal incluye los siguientes elementos:

[captura 01-inicio]
- Tu nombre, en **Te verán como** (1)
- **Crear reunión** (2), para abrir una reunión nueva en esta PC
- **Unirse con IP y código** (3), para entrar escribiendo la IP del anfitrión
- **Reuniones en tu red** (4), con las reuniones abiertas en la red local
- El pie de la ventana (la franja inferior), con la red y el firewall

En el pie se ven la red que usa la PC (1), el estado del firewall (2) y el botón **Ayuda de red** (3).

[captura 02-inicio-pie]

Al entrar a una reunión se abre la sala. En la PC anfitriona, arriba están la IP (1) y el código (2) para que otros se unan, el botón que copia los dos (3) y el botón de participantes (4).

[captura 05-crear-sala]

## 5. Flujo de Uso Paso a Paso

1. Abre Mirror Studio y crea una reunión.

Al abrir la aplicación, el logotipo de Mirror Studio aparece un momento en el centro y luego sube a la parte superior; después queda la pantalla de inicio. En **Te verán como** (1) escribe tu nombre, que verán los demás. Desde aquí puedes pulsar **Crear reunión** (2), usar **Unirse con IP y código** (3) o elegir una de las **Reuniones en tu red** (4).

[captura 01-inicio]

Antes de crear la reunión, revisa el pie de la ventana: **Red** (1) debe mostrar la IP de la PC (su dirección en la red, por ejemplo 192.168.1.20) y **Firewall** (2) debe decir **permitido**. Si dice **bloqueado** o **sin verificar**, pulsa **Ayuda de red** (3).

[captura 02-inicio-pie]

En la tarjeta **Crear reunión** escribe el nombre de la reunión (1) y pulsa **Crear reunión** (2). Si lo dejas vacío, se llamará **Reunión de** seguido de tu nombre.

[captura 03-crear-nombre]

Se abre la preparación. Revisa **Tu nombre** (1) y pulsa **Crear y entrar** (2).

[captura 04-crear-preparacion]

2. Copia la IP y el código para los demás.

La reunión queda abierta. Arriba se ven la **IP** (1) y el **Código** (2) que necesitan los demás para unirse, cada uno con su botón de copiar. El botón (3) copia los dos juntos, para pegarlos con Ctrl+V en un mensaje, y el botón (4) muestra u oculta el panel de participantes. La IP puede cambiar de un día a otro: usa siempre la que aparece aquí.

[captura 05-crear-sala]

3. Únete desde otra PC.

En la otra PC, la reunión aparece en **Reuniones en tu red**. Pulsa **Unirse** (1).

[captura 06-unirse-lista]

Si la reunión no aparece, escribe la IP del anfitrión en **Unirse con IP y código** (1) y pulsa **Continuar** (2).

[captura 07-unirse-ip]

En los dos casos se abre una pantalla con **Tu nombre** y **Código de la reunión** (1): escribe el código de 8 caracteres que te dio el anfitrión y pulsa **Entrar** (2).

[captura 08-unirse-codigo]

Si el código está mal, aparece el mensaje **Código incorrecto** (1) y no se entra. Revisa el código y vuelve a intentarlo. Después de 5 intentos fallidos hay que esperar un minuto.

[captura 09-unirse-error]

Al entrar se abre la sala. A la derecha está el panel de participantes (1) y abajo la barra de controles (2). Arriba se ve cuántas personas hay en la reunión.

[captura 10-unirse-sala]

4. Presenta tu pantalla o una ventana.

Cualquier persona de la reunión puede presentar. Pulsa **Presentar** (1) en la barra inferior. Si otra persona ya está presentando, solo alguien con un rol igual o mayor puede reemplazarla (de mayor a menor: creador, administrador, docente, participante).

[captura 11-presentar-boton]

En **¿Qué quieres presentar?** deja marcada la casilla **Compartir también el sonido de esta PC** (3) si quieres que todos oigan el audio, por ejemplo de un vídeo (solo en Windows). Luego pulsa **Pantalla principal** (1) o elige una de las ventanas (2).

[captura 12-presentar-selector]

Los demás ven la presentación (1). Al pasar el ratón por encima aparece el botón de pantalla completa (2); con Esc o con el mismo botón se vuelve a la vista normal.

[captura 13-presentar-vista]

5. Mira tu propia presentación u ocúltala.

Quien presenta ve lo mismo que los demás (1). Si presentas la pantalla donde está abierta Mirror Studio, se forma un espejo infinito (la imagen se repite dentro de sí misma, como dos espejos enfrentados): pulsa el botón del ojo (2) para ocultar tu vista.

[captura 14-presentar-espejo]

Con la vista oculta, los demás siguen viendo tu pantalla. Para verla otra vez pulsa **Ver lo que presento** (1).

[captura 15-presentar-oculto]

Para terminar la presentación pulsa **Detener** (1). Todos vuelven a ver a los participantes en cuadrícula.

[captura 16-presentar-detener]

6. Asigna roles.

El creador pulsa el botón de los tres puntos (1) junto al nombre de una persona. En el menú (2) aparecen las opciones que permite su rol: **Pedir control de su PC**, **Hacer docente**, **Hacer administrador**, **Quitar rol** y **Expulsar**. El administrador solo puede hacer docentes, quitar ese rol y expulsar a docentes y participantes. Todos pueden presentar, pero solo el creador, los administradores y los docentes pueden pedir control.

[captura 17-roles-menu]

7. Pide el control de otra PC.

El creador, un administrador o un docente abre el menú de los tres puntos de la persona y elige **Pedir control de su PC** (1). La PC que se va a controlar debe tener Windows.

[captura 18-control-pedir]

En la otra PC aparece la **Solicitud de control**. **Rechazar** (1) no entrega el control y **Permitir** (2) lo entrega. **Rechazar** viene seleccionado, así que si se pulsa Enter por error, se rechaza y no se entrega la PC.

[captura 19-control-solicitud]

Mientras dura el control, la PC controlada muestra arriba una barra roja (1) que dice quién la controla. Para cortarlo al instante pulsa **Detener control** (2) o las teclas Ctrl+Alt+Esc.

[captura 20-control-barra]

Quien controla ve la pantalla de la otra PC y la maneja con su ratón y su teclado; para escribir, primero hace clic en la imagen. La barra flotante **Controlando** (1) tiene el botón ↻ para reintentar si la imagen o los clics dejan de responder, el botón de pantalla completa (2) y el botón con una X (3) para dejar de controlar; abajo, **Soltar control** hace lo mismo.

[captura 21-control-vista]

En el panel de participantes, el recuadro **Controlando** (1) muestra quién controla a quién. **Detener** (2) termina el control.

[captura 22-control-panel]

Al terminar, las dos PCs reciben el aviso **Control finalizado** (1) con el motivo.

[captura 23-control-fin]

8. Oculta o muestra el panel de participantes.

El botón de participantes (1), arriba a la derecha, oculta el panel para ver la presentación más grande. Al pulsarlo otra vez vuelve a aparecer.

[captura 24-sala-panel-oculto]

9. Sal o termina la reunión.

Para salir de la reunión pulsa **Salir** (1). Si eres el creador, el botón dice **Terminar** y cierra la reunión para todos.

[captura 25-salir]

10. Cambia el tema de la aplicación.

Arriba a la derecha está el tema. El botón con el nombre de tu sistema (1), por ejemplo **Windows 11** o **Ubuntu**, hace que Mirror Studio siga el modo claro u oscuro del sistema. El interruptor (2) elige a mano el tema claro (sol) o el oscuro (luna). La aplicación recuerda tu elección.

[captura 28-tema]

Aparte del tema: si otras PCs no pueden unirse, en la pantalla de inicio pulsa **Ayuda de red**. La ventana **Red y firewall** muestra el comando para permitir Mirror Studio en el firewall (1); haz clic sobre él (se selecciona completo), pulsa Ctrl+C y ejecútalo una vez en PowerShell abierto como administrador. Luego pulsa **Cerrar** (2).

[captura 26-ayuda-red]

Y la aplicación entera luce así durante una reunión:

[captura 27-aplicacion-completa | 10]

## 7. Errores Comunes y Soluciones

- La reunión no aparece en la lista: las PCs pueden estar en redes distintas o la Wi-Fi puede aislar los equipos. Usa **Unirse con IP y código**.
- Otra PC no puede unirse, o entra pero no ve la pantalla ni oye el sonido: falta permitir Mirror Studio en el firewall de la PC anfitriona o la red está como Pública. Ejecuta el comando de **Ayuda de red** como administrador y pon la red como privada: Configuración → Red e Internet → Wi-Fi o Ethernet → propiedades de la red → **Tipo de perfil de red** → **Red privada**.
- La IP mostrada empieza por 192.168.56: es la dirección de VirtualBox, un programa de máquinas virtuales, y no la de la red real. Cierra VirtualBox o desactiva su adaptador: Configuración → Red e Internet → Configuración de red avanzada → elige el adaptador de VirtualBox → **Deshabilitar**.
- **Código incorrecto** varias veces: después de 5 intentos fallidos hay que esperar un minuto. El código no lleva 0, 1, I ni O.
- **El puerto 47800 ya está en uso**: ya hay otra ventana de Mirror Studio abierta en esa PC. Ciérrala (si no la ves, ciérrala desde el Administrador de tareas, Ctrl+Mayús+Esc) y vuelve a intentarlo.

## 8. Consejos de Buen Uso

- Usa la misma versión de Mirror Studio en todas las PCs.
- Prefiere el cable Ethernet: la Wi-Fi de muchas instituciones aísla los equipos o tiene poco ancho de banda.
- Deja el perfil de red de Windows en Privada.
- Cierra los programas de VPN (conexiones privadas a otras redes) y las máquinas virtuales mientras usas la aplicación.
- No presentes la ventana de Mirror Studio, para evitar el espejo infinito.
