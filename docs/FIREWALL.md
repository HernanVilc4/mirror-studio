# Guía de red y firewall para Mirror Studio

Para el personal de TI del laboratorio. Una página.

## Qué necesita
- PCs con Windows 10/11 conectadas por **cable Ethernet** a la **misma red** (misma subred, por ejemplo 192.168.10.x).
- **Puerto TCP 47800** entrante en la PC que crea la reunión (anfitrión). Los participantes solo hacen conexiones salientes.
- **UDP entrante entre las PCs** para la pantalla y el sonido de la PC (WebRTC usa puertos dinámicos). Por eso la regla es por **programa**, no por puerto.
  - Si el UDP no pasa, **ya no hay pantalla negra**: a los ~5 s la app manda la imagen sola por el **modo compatible (TCP)**, dentro de la conexión cifrada del puerto 47800. En la sala aparece la etiqueta «modo compatible (TCP)». Es algo más lento que UDP y sin el sonido de la PC; arreglar el firewall devuelve la vía rápida.
- No hace falta Internet.
- **Ancho de banda:** el anfitrión envía de 2,5 a 12 Mbps por espectador según el tamaño de la sala (unos 80 Mbps en total). Necesita **Gigabit**; en una red de 100 Mbps el límite real es mucho menor.
- **Vídeo por hardware:** la app prefiere H.264, que la tarjeta gráfica codifica (NVENC, Quick Sync, AMF). Con drivers de vídeo viejos puede caer a software y usar más CPU.

## Reparación automática
Al abrirse, Mirror Studio revisa el firewall de Windows (en segundo plano). Si encuentra una regla que **bloquea** el programa (Windows la crea cuando alguien pulsa *Cancelar* en la «Alerta de seguridad»), si falta el permiso, o si el perfil de la red actual (por ejemplo **Pública**) no está cubierto, pide **una vez** permiso de administrador (UAC) y deja:
- borradas todas las reglas de ese programa, incluidas las de bloqueo;
- una regla `Mirror Studio`: entrante, permitir, **todos los perfiles**, solo desde la subred local y rangos privados (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), nunca desde Internet.

Si nadie acepta el UAC, se repite con **Ayuda de red y firewall → Reparar firewall**. Si una directiva de dominio (GPO) ignora las reglas locales, o hay un firewall de antivirus, la app lo avisa y usa el modo compatible (TCP).

## Con el instalador
El instalador hace lo mismo (borra las reglas del programa y crea la regla para todos los perfiles, solo LAN) y la quita al desinstalar. Requiere permisos de administrador una vez.

## A mano (sin instalador)
En un CMD o PowerShell **como administrador**, una vez por PC:

```
netsh advfirewall firewall delete rule name=all program="C:\Program Files\Mirror Studio\Mirror Studio.exe"
netsh advfirewall firewall add rule name="Mirror Studio" dir=in action=allow program="C:\Program Files\Mirror Studio\Mirror Studio.exe" enable=yes profile=any remoteip=localsubnet,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16
```
La primera línea borra también las reglas de **bloqueo** que Windows crea al cancelar su aviso (un bloqueo gana a cualquier permiso). La app muestra estos comandos, con la ruta correcta de ese equipo, en **Ayuda de red y firewall**. Para quitarla:
`netsh advfirewall firewall delete rule name="Mirror Studio"`

## Perfil de red
Windows clasifica cada red como Pública, Privada o Dominio. La regla cubre los tres perfiles (solo para direcciones de la LAN), así que ya no hace falta cambiar la red a Privada.

## Si las PCs no se ven
| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| «No se detectaron reuniones» | VLAN o subredes distintas, o el anfitrión tiene firewall | Usar **Unirse con IP y código**. Comprobar el puerto desde otra PC: `Test-NetConnection IP-DEL-ANFITRION -Port 47800` |
| Conecta, la imagen tarda ~5 s y sale «modo compatible (TCP)» | El UDP está bloqueado (regla de bloqueo, antivirus, GPO) | Funciona igual. Para la vía rápida: aceptar el UAC o **Reparar firewall**; con antivirus, permitir `Mirror Studio.exe` en él |
| «Esta PC y el anfitrión tienen versiones distintas» | Una PC tiene la versión vieja (protocolo v3) | Instalar la misma versión en todas las PCs |
| Anuncia una IP equivocada | Hay adaptadores virtuales (VMware, WSL, VPN) | La app elige el Ethernet real; la IP aparece en el pie de la ventana. Si es otra, desactiva el adaptador virtual |
| «Código incorrecto» varias veces | Bloqueo de 1 minuto tras 5 intentos fallidos desde esa PC | Esperar un minuto y escribir el código de 8 caracteres (sin 0, 1, I ni O) |
| El puerto 47800 ya está en uso | Otra reunión de Mirror Studio abierta en el mismo equipo | Cerrarla primero |

## Seguridad
- El código de reunión (8 caracteres) **no viaja por la red**; solo sirve para demostrar que quien entra lo conoce. Todo lo demás va cifrado, también el vídeo del modo compatible (TCP).
- La lista de «reuniones detectadas» muestra el nombre y el número de personas a cualquiera en la subred, sin código. Entrar sí requiere el código.
- El control remoto solo funciona con permiso de la persona controlada, con una barra roja siempre visible y con el atajo **Ctrl+Alt+Esc** para detenerlo.
