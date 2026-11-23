# Guía de red y firewall para Mirror Studio

Para el personal de TI del laboratorio. Una página.

## Qué necesita
- PCs con Windows 10/11 conectadas por **cable Ethernet** a la **misma red** (misma subred, por ejemplo 192.168.10.x).
- **Puerto TCP 47800** entrante en la PC que crea la reunión (anfitrión). Los participantes solo hacen conexiones salientes.
- **UDP entrante entre las PCs** para la pantalla y el sonido de la PC (WebRTC usa puertos dinámicos). Por eso la regla es por **programa**, no por puerto.
- No hace falta Internet.
- **Ancho de banda:** el anfitrión envía ~2,5 Mbps por espectador. Con 35 personas son ~88 Mbps: necesita **Gigabit**; en una red de 100 Mbps el límite real es mucho menor.

## Con el instalador
El instalador crea solo la regla `Mirror Studio` (entrante, permitir, perfil **Privado y Dominio**, nunca Público) y la quita al desinstalar. Requiere permisos de administrador una vez.

## A mano (sin instalador)
En un CMD o PowerShell **como administrador**, una vez por PC:

```
netsh advfirewall firewall add rule name="Mirror Studio" dir=in action=allow program="C:\Program Files\Mirror Studio\Mirror Studio.exe" enable=yes profile=private,domain
```
La app muestra este comando, con la ruta correcta de ese equipo, en **Ayuda de red y firewall**. Para quitarla:
`netsh advfirewall firewall delete rule name="Mirror Studio"`

## Perfil de red
Windows clasifica cada red como Pública, Privada o Dominio. Si la red del laboratorio aparece como **Pública**, la regla no se aplica. Cámbiala a Privada: Configuración → Red e Internet → Ethernet → Propiedades → Perfil de red → *Privada*.

## Si las PCs no se ven
| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| «No se detectaron reuniones» | VLAN o subredes distintas, o el anfitrión tiene firewall | Usar **Unirse con IP y código**. Comprobar el puerto desde otra PC: `Test-NetConnection IP-DEL-ANFITRION -Port 47800` |
| Conecta pero sin pantalla ni sonido | Falta el UDP entrante | Revisar que la regla es por programa y que el perfil es Privado |
| Anuncia una IP equivocada | Hay adaptadores virtuales (VMware, WSL, VPN) | La app elige el Ethernet real; la IP aparece en el pie de la ventana. Si es otra, desactiva el adaptador virtual |
| «Código incorrecto» varias veces | Bloqueo de 1 minuto tras 5 intentos fallidos desde esa PC | Esperar un minuto y escribir el código de 8 caracteres (sin 0, 1, I ni O) |
| El puerto 47800 ya está en uso | Otra reunión de Mirror Studio abierta en el mismo equipo | Cerrarla primero |

## Seguridad
- El código de reunión (8 caracteres) **no viaja por la red**; solo sirve para demostrar que quien entra lo conoce. Todo lo demás va cifrado.
- La lista de «reuniones detectadas» muestra el nombre y el número de personas a cualquiera en la subred, sin código. Entrar sí requiere el código.
- El control remoto solo funciona con permiso de la persona controlada, con una barra roja siempre visible y con el atajo **Ctrl+Alt+Esc** para detenerlo.
