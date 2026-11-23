# Capturas y documentación de MirrorStudio

Fecha: 23 de noviembre de 2026. Revisión local: `4e9de1b`.

## Resultado de la entrega

Los tres Word están actualizados en `docs/entregables/`, copiados de sus plantillas originales. No hay avisos de capturas pendientes en ellos.

- Manual: 27 capturas únicas reales, anotadas y comprobadas visualmente. Se insertan 31 imágenes por las reutilizaciones previstas; la 27 reutiliza la 10.
- Para ejecutar: dos imágenes reales de la aplicación (ayuda de red y pantalla principal). Se usaron estas vistas en lugar de las dos imágenes de terminal solicitadas en GUIA-DOCUMENTACION.md, que no estuvieron disponibles. El texto identifica correctamente lo que muestran; no se presentan como evidencia de ejecución de comandos.
- Código fuente: los 11 archivos exigidos por la guía, tomados del checkout actual, con sus rutas, formato Consolas 9,5 y una captura real de inicio. El generador verifica el texto contra los archivos del repositorio. Los hashes están en `inventario-documentacion.json`.

Verificación: los tres paquetes DOCX son íntegros, conservan los estilos y las propiedades de página de sus respectivas plantillas y tienen 31, 2 y 1 imágenes. `anotar.py --test` pasa. No se modificaron las plantillas ni `docs/manual/textos.md`.

No se pudo renderizar los Word ni revisar visualmente sus páginas: el servicio de localización del runtime de documentos no estuvo disponible. La revisión de formato realizada compara estilos y propiedades de página por XML; no sustituye la inspección de la paginación en Word.

## Sesiones reales y diferencias observadas

Se usaron dos PCs Windows por hotspot. Primero la PC local creó «Clase de Redes», como «Docente», y CALEB entró como participante. Se comprobó la presentación en ambos sentidos, la vista propia y su ocultación, los roles, el consentimiento, el control remoto en ambos sentidos y la revocación. Después CALEB creó «Reu Caleb» y la PC local entró como «Alumno 1», tras comprobar un intento con código incorrecto.

- El nombre real de la otra PC es CALEB, en lugar del ejemplo «Alumno 1» del plan. Se intercambiaron los papeles para capturar el flujo de invitado sin simular otra PC.
- La IP anunciada al crear la primera sala fue 192.168.137.1. La sala de CALEB anunció 192.168.137.109. El pie de inicio local continuó mostrando 10.130.252.100. Las capturas reflejan esas direcciones reales, sin retocarlas.
- «Red y firewall» dice «solo por cable Ethernet», aunque esta prueba funcionó por hotspot. Se conserva la captura real y se registra la diferencia.
- La barra flotante de control es marrón rojiza; el aviso dentro de la sala es rojo. La captura 20 es la ventana flotante real (520 × 52 px); para acomodar las marcas se añadió un margen blanco de 24 px exclusivamente en su versión anotada.
- Las solicitudes de control caducan a los 30 s. Un primer intento tardío no produjo un control activo; se repitió la solicitud y se verificó su aceptación y posterior revocación.
- Las capturas 12 y 14–16 se tomaron desde la instancia local anfitriona. La 13 muestra la presentación recibida desde CALEB. La 10 se renovó desde la instancia local invitada y muestra «Salir»; la 25 conserva «Terminar», como corresponde al creador.
- La captura 22 reutiliza el original de la 21, del mismo estado real de control, para mostrar el vídeo y el panel juntos.

Estado al finalizar las capturas: PC local dentro de «Reu Caleb» como «Alumno 1»; no queda control remoto activo.

## Capturas incluidas

- `01-inicio.png`
- `02-inicio-pie.png`
- `03-crear-nombre.png`
- `04-crear-preparacion.png`
- `05-crear-sala.png`
- `06-unirse-lista.png`
- `07-unirse-ip.png`
- `08-unirse-codigo.png`
- `09-unirse-error.png`
- `10-unirse-sala.png`
- `11-presentar-boton.png`
- `12-presentar-selector.png`
- `13-presentar-vista.png`
- `14-presentar-espejo.png`
- `15-presentar-oculto.png`
- `16-presentar-detener.png`
- `17-roles-menu.png`
- `18-control-pedir.png`
- `19-control-solicitud.png`
- `20-control-barra.png`
- `21-control-vista.png`
- `22-control-panel.png`
- `23-control-fin.png`
- `24-sala-panel-oculto.png`
- `25-salir.png`
- `26-ayuda-red.png`
- `28-tema.png`

## Resultado de armar_manual.py

```text
Listo: D:\mirror-studio\docs\entregables\Mirror Studio - manual de uso.docx (31 capturas puestas)
Captura 27 -> se usa la 10
No falta ninguna captura.
```

Para regenerar los tres Word: `python docs/tools/armar_entregables.py`.

`git pull --ff-only` estuvo bloqueado por acceso denegado a `.git/FETCH_HEAD`; no se confirmó si GitHub tiene commits posteriores. No se hizo commit ni push.
