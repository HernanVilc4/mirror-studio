# Prueba en Windows: guía para quien prueba

Necesitas **dos PCs Windows 10/11** conectadas por **cable Ethernet** a la misma red (ideal: las del laboratorio). No hace falta Internet ni instalar Node.

## 1. Instalar (en las dos PCs)
1. Descarga `Mirror Studio Setup 0.1.0.exe` de la sección **Releases** del repositorio (o el `.zip` portable: descomprimir y ejecutar `Mirror Studio.exe`).
2. Windows mostrará un aviso azul de **SmartScreen** porque el instalador no está firmado: *Más información → Ejecutar de todos modos*.
3. Con el instalador la regla de firewall se crea sola (pide permisos de administrador). Con el portable, abre PowerShell **como administrador** y ejecuta una vez el comando de `FIREWALL.md` (ruta al `.exe` incluida).
4. Comprueba que la red está como **Privada** (`FIREWALL.md`, sección *Perfil de red*).

## 2. Prueba mínima (10 minutos)
**PC A (anfitrión):** abrir la app → *Crear reunión* → *Crear y entrar*. Arriba aparece `IP · CÓDIGO`.
**PC B:** *Reuniones detectadas* debería mostrar la reunión. Si no aparece, usar *Unirse con IP y código*. Escribir el código → *Entrar*.

Marca cada punto como ✅ / ❌ y anota qué pasó:

| # | Prueba | Resultado |
|---|---|---|
| 1 | La PC B ve la reunión en la lista (o entra con IP y código) | |
| 2 | Un código incorrecto se rechaza con mensaje claro | |
| 3 | A y B se ven en «Participantes» (2 personas) | |
| 4 | En A: «⋮» sobre B → *Hacer docente*. En B aparece el botón de presentar | |
| 5 | B presenta **pantalla principal**; A ve la imagen | |
| 6 | B presenta con «Compartir también el sonido de esta PC» y reproduce un vídeo con sonido: **A lo oye** | |
| 7 | B presenta una **ventana** concreta (no la pantalla entera) | |
| 8 | A pide control de B («⋮» → *Pedir control de su PC*). En B aparece el diálogo; **Rechazar** funciona | |
| 9 | Repetir y **Permitir**: aparece la barra roja arriba en B; A mueve el ratón y escribe en B | |
| 10 | En B, **Ctrl+Alt+Esc** (o «Detener control») corta el control al instante | |
| 11 | Mientras A controla a B, mantener una tecla (p. ej. Shift) y **desconectar el cable de A**: en B no queda ninguna tecla pegada | |
| 12 | Si A (anfitrión) pulsa *Terminar reunión*, B vuelve al inicio con un aviso | |
| 13 | Escalado: repetir 5 y 9 con Windows al **125 %** y **150 %** (¿el clic cae donde debe?) | |
| 14 | Teclado: recorrer Inicio → Preparación → Sala solo con Tab/Enter/Esc | |

## 3. Qué anotar si algo falla
- Versión de Windows, perfil de red (Pública/Privada), si hay VPN o adaptadores virtuales.
- Qué IP muestra el pie de la ventana de inicio (¿es la del Ethernet?).
- Captura de pantalla del error. Si la app se cierra, el texto de la ventana que aparezca.
- Para PowerShell: `Test-NetConnection IP-DEL-ANFITRION -Port 47800`.

## 4. Lo más probable que falle (nunca se ejecutó en Windows)
- **Pruebas 9–11 (control):** la inyección de ratón y teclado usa `SendInput` mediante un PowerShell persistente; se escribió sin poder probarlo.
- **Prueba 6 (sonido):** la captura del audio del sistema solo existe en Windows y no se pudo verificar.
- **Prueba 13 (escalado):** las coordenadas se normalizan sobre la pantalla principal; varios monitores no están soportados.

Para medir la carga con muchos espectadores, ver `apps/desktop/scripts/video-load` (necesita Node) y el `HANDOFF.md`.
