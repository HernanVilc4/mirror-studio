# Prompt para GPT (computer use): capturas del Manual de Uso de MirrorStudio

Copia todo lo que está debajo de la línea y pégalo en GPT con computer use, en la PC donde está el proyecto.

---

Vas a hacer las capturas del **Manual de Uso de MirrorStudio**, usando la aplicación de verdad con computer use. Cada captura debe llevar marcas rojas numeradas que indiquen dónde pulsar. El texto del manual ya está escrito y el Word se arma solo con un script. Tu trabajo es dejar cada pantalla en el estado indicado, capturarla, marcarla y comprobarla.

## 0. Preparación (una vez)

1. Abre una terminal en la carpeta del proyecto `mirror-studio` y actualiza:
   ```
   git pull
   npm install
   npm run build -w @mirror-studio/protocol
   pip install pillow python-docx lxml
   python docs/tools/anotar.py --test
   ```
   El último comando debe imprimir `ok`.
2. Abre la app con `npm run dev`. Si ya estaba abierta, ciérrala antes con Ctrl+C en su terminal y vuelve a abrirla. Debe verse la marca de dos erres «MirrorStudio».
3. Pon la ventana de MirrorStudio **maximizada**, con el escalado de Windows al **100 %**. No dejes notificaciones ni otras ventanas encima.
4. Tema: arriba a la derecha, deja el interruptor en **claro (sol)**. Todas las capturas van en tema claro, porque quedan mejor en la hoja blanca del Word, salvo la 28, que muestra el interruptor.
5. Hay **dos PCs** en la misma red, las dos con la app actualizada:
   - **A = anfitrión:** crea la reunión. Nombre visible: «Docente».
   - **B = invitado:** se une. Nombre visible: «Alumno 1».

   Tú manejas la PC en la que estás. Cuando una captura sea de la otra PC o necesite una acción allí (aceptar el control, presentar, unirse), **detente y pídemelo**. Si hace falta, intercambiamos papeles. No inventes pantallas.
6. Crea las carpetas `docs/manual/capturas/` y `docs/manual/anotadas/`.

## 1. Cómo capturar

- Captura **solo la ventana de MirrorStudio**, completa (Alt+Impr Pant o Win+Mayús+S → Ventana), en PNG, sin la barra de tareas ni el escritorio. **Excepción:** la 20 incluye la barra roja que aparece arriba de la pantalla, fuera de la ventana. Ahí captura la parte superior de la pantalla.
- Guárdala como `docs/manual/capturas/NN-nombre.png`, con el nombre exacto de la tabla.
- Si la pantalla real no coincide con lo que dice la tabla (falta un botón, cambió un texto), **no inventes ni la retoques**: anótalo y sigue con la siguiente.

## 2. Cómo marcar (mismo estilo en todas)

Usa siempre el script. Dibuja marcas rojas numeradas y todas quedan iguales:

```
python docs/tools/anotar.py docs/manual/capturas/NN-nombre.png docs/manual/anotadas/NN-nombre.png MARCA MARCA ...
```

| Qué señalas | Marca | Sintaxis |
|---|---|---|
| Botón pequeño o icono (copiar, ⋮, participantes, ojo, pantalla completa, X) | círculo | `circulo:X,Y,RADIO:N` |
| Botón ancho (Crear reunión, Unirse, Permitir, Entrar…) | óvalo | `ovalo:X1,Y1,X2,Y2:N`, con la caja del botón |
| Zona: tarjeta, campo, lista, panel, barra, mensaje | borde punteado | `rect:X1,Y1,X2,Y2:N` |

- Las coordenadas son **píxeles de la captura**. Mídelas sobre la propia imagen.
- **N es el número que el texto del manual pone entre paréntesis**: (1), (2), (3)… Respeta la columna «Marcas».
- La marca rodea el elemento **sin taparlo**. Como máximo 4 marcas por imagen. Nada de flechas ni textos añadidos.
- Después de cada una, **abre la imagen marcada y comprueba** que cada número rodea el elemento correcto. Si no, corrige las coordenadas y repite.
- Referencia del resultado esperado: `docs/tools/ejemplo-anotacion.png`.

## 3. Lista de capturas

| NN | Archivo | PC | Estado de la pantalla | Marcas (N = número del texto) |
|---|---|---|---|---|
| 01 | `01-inicio.png` | B | Pantalla de inicio, con la reunión de A visible en «Reuniones en tu red» | (1) rect: «Te verán como» con el nombre · (2) óvalo: botón «Crear reunión» · (3) rect: tarjeta «Unirse con IP y código» · (4) rect: tarjeta «Reuniones en tu red» |
| 02 | `02-inicio-pie.png` | B | Inicio. Basta con la parte de abajo de la ventana | (1) rect: «Red …» · (2) rect: «Firewall …» · (3) óvalo: «Ayuda de red» |
| 03 | `03-crear-nombre.png` | A | Tarjeta «Crear reunión» con un nombre escrito, por ejemplo «Clase de Redes» | (1) rect: campo del nombre · (2) óvalo: «Crear reunión» |
| 04 | `04-crear-preparacion.png` | A | Pantalla de preparación | (1) rect: «Tu nombre» · (2) óvalo: «Crear y entrar» |
| 05 | `05-crear-sala.png` | A | Sala recién creada | (1) rect: IP · (2) rect: Código · (3) círculo: botón de la cadena (copia IP y código) · (4) círculo: botón de participantes |
| 06 | `06-unirse-lista.png` | B | Inicio, con la reunión de A en la lista | (1) óvalo: «Unirse» |
| 07 | `07-unirse-ip.png` | B | «Unirse con IP y código» con la IP de A escrita | (1) rect: campo de la IP · (2) óvalo: «Continuar» |
| 08 | `08-unirse-codigo.png` | B | Preparación con el código escrito (8 caracteres) | (1) rect: «Código de la reunión» · (2) óvalo: «Entrar» |
| 09 | `09-unirse-error.png` | B | Tras escribir un código **incorrecto** y pulsar Entrar | (1) rect: mensaje de error |
| 10 | `10-unirse-sala.png` | B | Sala con 2 personas. Esta captura también se usa como 27 | (1) rect: panel de participantes · (2) rect: barra inferior de controles |
| 11 | `11-presentar-boton.png` | B | Sala, barra inferior | (1) círculo: «Presentar» |
| 12 | `12-presentar-selector.png` | B | Ventana «¿Qué quieres presentar?» | (1) óvalo: «Pantalla principal» · (2) rect: miniaturas de ventanas · (3) círculo: casilla «Compartir también el sonido de esta PC» |
| 13 | `13-presentar-vista.png` | A | Viendo la presentación de B, con el ratón encima para que aparezca el botón | (1) rect: la presentación · (2) círculo: botón de pantalla completa (arriba a la derecha del vídeo) |
| 14 | `14-presentar-espejo.png` | B | B presentando: ve su propia presentación. Ratón encima | (1) rect: la vista · (2) círculo: botón del ojo |
| 15 | `15-presentar-oculto.png` | B | Tras pulsar el ojo: vista oculta | (1) óvalo: «Ver lo que presento» |
| 16 | `16-presentar-detener.png` | B | Barra inferior mientras presenta | (1) círculo: «Detener» |
| 17 | `17-roles-menu.png` | A | Menú de los tres puntos de «Alumno 1» abierto | (1) círculo: botón ⋮ · (2) rect: el menú con las opciones |
| 18 | `18-control-pedir.png` | A | El mismo menú, con «Pedir control de su PC» a la vista | (1) rect: la opción «Pedir control de su PC» |
| 19 | `19-control-solicitud.png` | B (Windows) | Diálogo «Solicitud de control» | (1) óvalo: «Rechazar» · (2) óvalo: «Permitir» |
| 20 | `20-control-barra.png` | B (Windows) | Controlada: barra roja arriba de la **pantalla** | (1) rect: barra roja · (2) óvalo: «Detener control» |
| 21 | `21-control-vista.png` | A | Controlando a B: se ve su pantalla | (1) rect: barra flotante «Controlando …» · (2) círculo: pantalla completa · (3) círculo: X (dejar de controlar) |
| 22 | `22-control-panel.png` | A | Panel de participantes con el recuadro «Controlando» | (1) rect: recuadro «Controlando» · (2) óvalo: «Detener» |
| 23 | `23-control-fin.png` | A o B | Aviso «Control finalizado: …» justo después de detener | (1) rect: el aviso |
| 24 | `24-sala-panel-oculto.png` | A | Sala con el panel de participantes oculto | (1) círculo: botón de participantes (arriba a la derecha) |
| 25 | `25-salir.png` | A | Barra inferior de la sala | (1) círculo: «Terminar» (en B dice «Salir») |
| 26 | `26-ayuda-red.png` | A o B | Inicio → «Ayuda de red»: ventana «Red y firewall» | (1) rect: el comando del firewall · (2) óvalo: «Cerrar» |
| 28 | `28-tema.png` | A o B | Barra superior. Captura toda la ventana en tema **oscuro** con el interruptor a la vista y luego vuelve a claro | (1) óvalo: botón con el nombre del sistema (por ejemplo «Windows 11») · (2) óvalo: interruptor sol/luna |

**Orden sugerido** para no repetir pasos:
1. A crea la reunión (03, 04, 05).
2. B en el inicio (01, 02, 06, 07, 08, 09) y entra (10).
3. B presenta (11, 12, 14, 15, 16), mientras A captura la 13.
4. A con roles y control (17, 18). B acepta (19, 20) y A controla (21, 22). Al detener, la 23.
5. A oculta el panel (24) y captura «Terminar» (25).
6. Ayuda de red (26) y tema (28).

## 4. Armar el Word y comprobar

1. Ejecuta:
   ```
   python docs/tools/armar_manual.py
   ```
   Genera `docs/entregables/Mirror Studio - manual de uso.docx` a partir de la plantilla, con su mismo formato. Al final debe decir **«Capturas pendientes (0)»**. Si lista alguna, falta ese archivo en `docs/manual/anotadas/`.
2. Abre el Word y la plantilla `docs/pushpromaster - manual de uso_….docx` lado a lado. Comprueba:
   - mismas fuentes, colores, títulos y márgenes
   - cada captura debajo de su párrafo
   - las marcas coinciden con los números del texto

   **No cambies el formato del Word ni edites `docs/manual/textos.md`.** Si algo del texto no coincide con la app, anótalo para que lo revisemos.
3. Al terminar, dame:
   - la lista de capturas hechas
   - las que no pudiste hacer y por qué
   - lo que no coincidía entre el texto y la app
   - el resultado de `armar_manual.py`
