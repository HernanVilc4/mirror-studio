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

Mirror Studio es una aplicación de escritorio para hacer reuniones en una red local, sin Internet. Permite presentar la pantalla o una ventana con el sonido de la PC, y pedir el control remoto de otra PC con su permiso. Cada persona tiene un rol: creador, administrador, docente o participante. Ideal para aulas y laboratorios donde todas las PCs están en la misma red.

## 2. Requisitos del Sistema

- Windows 10 u 11 (Ubuntu también abre la aplicación, pero el control remoto es solo de Windows)
- Todas las PCs conectadas a la misma red local (misma Wi-Fi, mismo switch o cable)
- Git instalado en el sistema (https://git-scm.com), solo si se ejecuta el código fuente
- Node.js 22 LTS o superior (https://nodejs.org), solo si se ejecuta el código fuente
- Conexión a Internet solo para instalar; la aplicación funciona sin Internet

## 3. Instalación

- Descomprime Mirror-Studio-win32-x64.zip y ejecuta Mirror Studio.exe con doble clic. También puedes usar el instalador Mirror Studio Setup 0.1.0.exe.
- Si Windows muestra el aviso de SmartScreen, pulsa **Más información** y luego **Ejecutar de todos modos**.
- Si deseas usar el código fuente:
  1. Instala Git y Node.js.
  2. Descarga el proyecto con: git clone https://github.com/HernanVilc4/mirror-studio.git
  3. Instala las dependencias con: npm install y luego npm run build -w @mirror-studio/protocol
  4. Ejecuta la aplicación con: npm run dev
- En la PC que creará la reunión, permite Mirror Studio en el firewall de Windows una sola vez, como administrador. El comando aparece en **Ayuda de red**, en la pantalla de inicio.

## 4. Interfaz Principal

La ventana principal incluye los siguientes elementos:

[captura 01-inicio]
- Tu nombre, en **Te verán como** (1)
- Crear reunión (2), para abrir una reunión nueva en esta PC
- Unirse con IP y código (3), para entrar escribiendo la IP del anfitrión
- Reuniones en tu red (4), con las reuniones abiertas en la red local
- El pie de la ventana, con la red y el firewall

En el pie se ven la red que usa la PC (1), el estado del firewall (2) y el botón **Ayuda de red** (3).

[captura 02-inicio-pie]

Al entrar a una reunión se abre la sala. En la PC anfitriona, arriba están la IP (1) y el código (2) para que otros se unan, el botón que copia los dos (3) y el botón de participantes (4).

[captura 05-crear-sala]

## 5. Flujo de Uso Paso a Paso

1. Abre Mirror Studio y crea una reunión.

Al abrir la aplicación aparece la pantalla de inicio. En **Te verán como** (1) escribe tu nombre. Desde aquí puedes pulsar **Crear reunión** (2), usar **Unirse con IP y código** (3) o elegir una de las **Reuniones en tu red** (4).

[captura 01-inicio]

Antes de crear la reunión, revisa el pie de la ventana: **Red** (1) debe mostrar la IP de la PC y **Firewall** (2) debe decir **permitido**. Si no es así, pulsa **Ayuda de red** (3).

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

Escribe el **Código de la reunión** (1), que tiene 8 caracteres, y pulsa **Entrar** (2).

[captura 08-unirse-codigo]

Si el código está mal, aparece el mensaje **Código incorrecto** (1) y no se entra. Revisa el código y vuelve a intentarlo. Después de 5 intentos fallidos hay que esperar un minuto.

[captura 09-unirse-error]

Al entrar se abre la sala. A la derecha está el panel de participantes (1) y abajo la barra de controles (2). Arriba se ve cuántas personas hay en la reunión.

[captura 10-unirse-sala]

4. Presenta tu pantalla o una ventana.

Cualquier persona de la reunión puede presentar. Pulsa **Presentar** (1) en la barra inferior. Si otra persona ya está presentando, solo alguien con un rol igual o mayor puede reemplazarla.

[captura 11-presentar-boton]

En **¿Qué quieres presentar?** deja marcada la casilla **Compartir también el sonido de esta PC** (3) si quieres que todos oigan el audio, por ejemplo de un vídeo (solo en Windows). Luego pulsa **Pantalla principal** (1) o elige una de las ventanas (2).

[captura 12-presentar-selector]

Los demás ven la presentación (1). Al pasar el ratón por encima aparece el botón de pantalla completa (2); con Esc o con el mismo botón se vuelve a la vista normal.

[captura 13-presentar-vista]

5. Mira tu propia presentación u ocúltala.

Quien presenta ve lo mismo que los demás (1). Si presentas la pantalla donde está abierta Mirror Studio, se forma un espejo infinito: pulsa el botón del ojo (2) para ocultar tu vista.

[captura 14-presentar-espejo]

Con la vista oculta, los demás siguen viendo tu pantalla. Para verla otra vez pulsa **Ver lo que presento** (1).

[captura 15-presentar-oculto]

Para terminar la presentación pulsa **Detener** (1). Todos vuelven a ver a los participantes en cuadrícula.

[captura 16-presentar-detener]

6. Asigna roles.

El creador pulsa el botón de los tres puntos (1) junto al nombre de una persona. En el menú (2) aparecen las opciones que permite su rol: **Pedir control de su PC**, **Hacer docente**, **Hacer administrador**, **Quitar rol** y **Expulsar**. El administrador solo puede hacer docentes, quitar ese rol y expulsar a docentes y participantes. Todos pueden presentar, pero solo los docentes y administradores pueden pedir control.

[captura 17-roles-menu]

7. Pide el control de otra PC.

Un docente o administrador abre el menú de los tres puntos de la persona y elige **Pedir control de su PC** (1). La PC que se va a controlar debe tener Windows.

[captura 18-control-pedir]

En la otra PC aparece la **Solicitud de control**. **Rechazar** (1) no entrega el control y **Permitir** (2) lo entrega. El foco empieza en **Rechazar**, así que pulsar Enter por error no entrega la PC.

[captura 19-control-solicitud]

Mientras dura el control, la PC controlada muestra arriba una barra roja (1) que dice quién la controla. Para cortarlo al instante pulsa **Detener control** (2) o las teclas Ctrl+Alt+Esc.

[captura 20-control-barra]

Quien controla ve la pantalla de la otra PC y la maneja con su ratón y su teclado; para escribir, primero hace clic en la imagen. La barra flotante **Controlando** (1) tiene el botón de pantalla completa (2) y el botón con una X (3) para dejar de controlar.

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

Si otras PCs no pueden unirse, en la pantalla de inicio pulsa **Ayuda de red**. La ventana **Red y firewall** muestra el comando para permitir Mirror Studio en el firewall (1); cópialo y ejecútalo una vez en PowerShell abierto como administrador. Luego pulsa **Cerrar** (2).

[captura 26-ayuda-red]

Y la aplicación entera luce así durante una reunión:

[captura 27-aplicacion-completa | 10]

## 7. Errores Comunes y Soluciones

- La reunión no aparece en la lista: las PCs pueden estar en redes distintas o la Wi-Fi puede aislar los equipos. Usa **Unirse con IP y código**.
- Otra PC no puede unirse, o entra pero no ve la pantalla ni oye el sonido: falta permitir Mirror Studio en el firewall de la PC anfitriona o la red está como Pública. Ejecuta el comando de **Ayuda de red** como administrador y pon el perfil de red en Privada.
- La IP mostrada es 192.168.56.x: es el adaptador de VirtualBox. Actualiza Mirror Studio y, si sigue, desactiva el adaptador virtual.
- **Código incorrecto** varias veces: después de 5 intentos fallidos hay que esperar un minuto. El código no lleva 0, 1, I ni O.
- **El puerto 47800 ya está en uso**: hay otra ventana de Mirror Studio abierta en esa PC. Ciérrala, o cierra Mirror Studio desde el Administrador de tareas.

## 8. Consejos de Buen Uso

- Usa la misma versión de Mirror Studio en todas las PCs.
- Prefiere el cable Ethernet: la Wi-Fi de muchas instituciones aísla los equipos o tiene poco ancho de banda.
- Deja el perfil de red de Windows en Privada.
- Cierra VPN y máquinas virtuales mientras usas la aplicación.
- No presentes la ventana de Mirror Studio, para evitar el espejo infinito.
