# Mirror Studio

Reuniones, presentación de pantalla y control de PC en **red local por Ethernet**, entre PCs Windows 10/11. Sin Internet. Alternativa local a Meet para laboratorios y aulas. Estado, fases y decisiones: ver `HANDOFF.md`. Red y firewall: `docs/FIREWALL.md`.

Monorepo:
- `packages/protocol`: mensajes (zod), roles y permisos, código de sesión, criptografía del handshake (`src/node.ts`, solo Node).
- `apps/desktop`: Electron + React + TypeScript + Tailwind.
  - `main/meeting.ts`: estado autoritativo de la reunión (roles, presentador, control). Valida toda acción.
  - `main/meeting-net.ts`: servidor y cliente WebSocket con handshake autenticado y canal AES-GCM.
  - `main/app-session.ts`: une la reunión con la inyección de entrada y garantiza la liberación de teclas.
  - `main/input.ts`: inyección de ratón y teclado (Windows, vía `SendInput` en un PowerShell persistente).
  - `main/network.ts`: elección de interfaz Ethernet, descubrimiento y comprobación del firewall.
  - `renderer/src/media.ts`: concentrador WebRTC del anfitrión (pantalla y sonido de la PC) y conexión de cada participante.
- Android y móviles: **fuera de alcance** (en los laboratorios no se expone el WiFi a la red Ethernet); su código se eliminó.

## Comandos

```
npm install
npm test            # protocolo + reuniones + red + control (automáticas)
npm run typecheck
npm run build
npm run dev         # abre la app
npm run dist:portable                      # release/Mirror-Studio-win32-x64.zip: descomprimir en Windows y ejecutar
npm run dist -w @mirror-studio/desktop     # release/Mirror Studio Setup 0.1.0.exe (instalador NSIS)
```

## Arquitectura

```
Participante ──ws:47800 (handshake + AES-GCM)──► Anfitrión (MeetingHost valida todo)
Participante ══ WebRTC (DTLS-SRTP): pantalla + sonido de la PC ══► Concentrador en la ventana del anfitrión
```
El anfitrión es el creador; si sale, la reunión termina. El código de reunión (8 caracteres) no viaja por la red: se usa en un intercambio de claves X25519 con confirmación HMAC (ver `packages/protocol/src/node.ts`, con su límite conocido frente a un atacante activo).

## Estado real

| Elemento | Estado |
|---|---|
| Protocolo, roles, permisos, código de sesión | Hecho, probado |
| Handshake autenticado y canal cifrado (replay, manipulación, impostor, bloqueo por intentos) | Hecho, probado |
| Sesiones con roles, expulsar, un presentador | Hecho, probado |
| Control de PC: consentimiento, revocación, liberación de teclas al desconectar | Lógica hecha y probada; **inyección real en Windows sin probar** |
| Interfaz (inicio, preparación, sala, consentimiento, barra indicadora) | Hecha; verificada con dos instancias de Electron en Linux |
| Presentación de pantalla (docente → anfitrión) | Verificada en Linux: el anfitrión recibe vídeo 1920×1080 |
| Sonido de la PC al presentar (sin micrófono) | Enrutamiento verificado en Linux con audio sintético; **captura real del sistema (solo Windows) sin probar** |
| 35 participantes | Medido en una PC de 12 núcleos: control 146 ms, vídeo ≈37 % de un núcleo; **falta una PC típica de laboratorio y red real** |
| Paquete portable de Windows | **Generado** (`npm run dist:portable`); sin ejecutar en Windows |
| Instalador Windows y regla de firewall | **Construido** (98 MB); sin ejecutar en Windows ni firmar |
| Prueba entre dos PCs reales en Windows | **Pendiente** |
