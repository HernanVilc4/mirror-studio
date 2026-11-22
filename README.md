# Mirror Studio

Retransmisión y control de Android en el escritorio por Wi-Fi local (WebRTC). Monorepo:

- `packages/protocol` — esquemas zod, límites, helpers (fuente de verdad; Android replica el JSON/HMAC).
- `apps/desktop` — Electron + React + TS + Tailwind. Servidor de señalización (`src/main/signaling.ts`), mDNS (`_mirrorstudio._tcp`), QR, receptor WebRTC en el renderer.
- `apps/android` — Kotlin + Compose + MediaProjection + WebRTC (`stream-webrtc-android`).

## Arquitectura (resumen)

```
Android (offerer) --ws:47800 JSON--> Electron main (relay) --IPC--> renderer (RTCPeerConnection answerer)
Android ==== WebRTC (DTLS-SRTP): video + DataChannel "control" ====> renderer
```

Emparejamiento: el QR/pantalla muestra `host:port + token` (16 bytes aleatorios, un solo uso, caduca en 5 min).
El teléfono envía `hello`; el usuario debe **aprobar** en el desktop; offer/answer llevan `sig = HMAC-SHA256(token, sdp)`
para atar el fingerprint DTLS al secreto del QR (evita MITM en señalización ws:// sin TLS).
El control (`pointer`, `key`, …) viaja por DataChannel, separado del video. Coordenadas normalizadas 0..1 sobre la imagen
mostrada (`mapPointToDevice` descuenta el letterbox).

## Comandos

```
npm install
npm test          # protocol + señalización (automáticas)
npm run typecheck
npm run dev       # desktop (Electron)
```
Android: abrir `apps/android` en Android Studio (genera el wrapper de Gradle) y ejecutar.

## Estado real

| Elemento | Estado |
|---|---|
| Protocolo, validación, mapeo de coordenadas | Hecho, 8 tests |
| Señalización (pairing QR y sin QR, aprobación, token único, firma SDP, malformados, aislamiento) | Hecho, 5 tests |
| PC → PC (compartir pantalla a otra instancia, descubrimiento /24) | **Verificado en un solo equipo** (la app se comparte a sí misma por loopback): transmite, ~39 fps, rtt 1 ms, buffer 20 ms, 640x360. No probado entre dos PCs ni en Linux |
| Descubrimiento por subred en Android | Compila; **no probado** |
| Android: retransmisión, QR, permisos de inicio, UI animada | Compila (APK debug); **no probado en teléfono** |
| Control del teléfono (AccessibilityService) | Implementado y compilado; el usuario reporta que **no funcionó** en su prueba. Causa sin identificar; hay diagnóstico en pantalla (contador de órdenes, estado del permiso) |
| Control PC → PC | No implementado (necesita inyección de input nativa) |
| scrcpy (Modo B) | No implementado. Referencia: scrcpy es Apache-2.0; inyecta input con un servidor por ADB, sin MediaProjection ni accesibilidad |
| Linux Wayland/X11, multi-escena, presentación, empaquetado | Pendiente |

Modo de prueba local: la variable de entorno `MS_SELFTEST=1` hace que la app se comparta a sí misma por loopback y se auto-apruebe.
