package com.mirrorstudio.protocol

import java.io.ByteArrayOutputStream
import java.net.URI
import java.net.http.HttpClient
import java.net.http.WebSocket
import java.nio.ByteBuffer
import java.util.concurrent.CompletableFuture
import java.util.concurrent.CompletionStage
import java.util.concurrent.TimeUnit
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/** El telefono habla con un anfitrion de escritorio real: saludo cifrado, bienvenida, estado y salida. */
class InteropTest {
    private lateinit var host: TestHost

    @BeforeTest fun start() { host = TestHost.start() }
    @AfterTest fun stop() { host.close() }

    /** Cliente minimo con el WebSocket del JDK: suficiente para probar el protocolo sin Android. */
    private class Client(private val code: String, name: String) : WebSocket.Listener {
        private val hs = ClientHandshake(code, name)
        var channel: SecureChannel? = null
        val messages = java.util.concurrent.LinkedBlockingQueue<ServerMessage>()
        val rejected = CompletableFuture<String>()
        val closed = CompletableFuture<Int>()
        private val text = StringBuilder()
        private val bin = ByteArrayOutputStream()
        lateinit var ws: WebSocket

        override fun onOpen(webSocket: WebSocket) {
            ws = webSocket
            webSocket.sendText(Wire.encodeHello(hs.hello()), true)
            webSocket.request(1)
        }

        override fun onText(webSocket: WebSocket, data: CharSequence, last: Boolean): CompletionStage<*>? {
            text.append(data)
            if (last) {
                val t = text.toString(); text.setLength(0)
                when (Wire.messageType(t)) {
                    "hello-reply" -> webSocket.sendText(Wire.encodeConfirm(hs.onReply(Wire.parseHelloReply(t)!!)!!), true)
                    "confirm-ok" -> channel = hs.verifyOk(Wire.parseConfirmOk(t)!!) ?: error("El anfitrion no probo el codigo")
                    "reject" -> rejected.complete(Wire.parseReject(t)!!.reason)
                }
            }
            webSocket.request(1)
            return null
        }

        override fun onBinary(webSocket: WebSocket, data: ByteBuffer, last: Boolean): CompletionStage<*>? {
            val b = ByteArray(data.remaining()); data.get(b); bin.write(b)
            if (last) {
                val frame = bin.toByteArray(); bin.reset()
                val plain = channel!!.openText(frame) ?: error("Trama cifrada invalida")
                Wire.parseServer(plain)?.let { messages.add(it) }
            }
            webSocket.request(1)
            return null
        }

        override fun onClose(webSocket: WebSocket, statusCode: Int, reason: String): CompletionStage<*>? {
            closed.complete(statusCode); return null
        }

        fun send(m: ClientMessage) { ws.sendBinary(ByteBuffer.wrap(channel!!.seal(Wire.encode(m))), true).join() }

        inline fun <reified T : ServerMessage> next(seconds: Long = 20): T {
            while (true) {
                val m = messages.poll(seconds, TimeUnit.SECONDS) ?: error("No llego ${T::class.simpleName}")
                if (m is T) return m
            }
        }
    }

    private fun connect(code: String, name: String): Client {
        val c = Client(code, name)
        HttpClient.newHttpClient().newWebSocketBuilder().buildAsync(URI("ws://127.0.0.1:${host.port}"), c).get(10, TimeUnit.SECONDS)
        return c
    }

    @Test fun `se une a un anfitrion real y recibe la bienvenida`() {
        val c = connect(formatCode(host.code), "Galaxy de Caleb")
        val w = c.next<Welcome>()
        assertEquals("Clase de prueba", w.state.name)
        val me = w.state.participants.single { it.id == w.you }
        assertEquals("Galaxy de Caleb", me.name)
        assertEquals(Role.PARTICIPANT, me.role)
        assertTrue(w.state.participants.any { it.role == Role.CREATOR && it.name == "Ana" })
        // Como MeetingClient.close() del escritorio: avisa con `leave` y luego cierra el socket el propio cliente.
        c.send(Leave)
        c.ws.sendClose(WebSocket.NORMAL_CLOSURE, "").join()
        assertNotNull(c.closed.get(10, TimeUnit.SECONDS))
    }

    @Test fun `un codigo incorrecto se rechaza con un mensaje claro`() {
        val wrong = host.code.map { ch -> CODE_ALPHABET[(CODE_ALPHABET.indexOf(ch) + 1) % CODE_ALPHABET.length] }.joinToString("")
        val c = connect(wrong, "Intruso")
        assertEquals("Código incorrecto", c.rejected.get(20, TimeUnit.SECONDS))
    }

    @Test fun `el canal cifrado sigue funcionando en los dos sentidos tras la bienvenida`() {
        val c = connect(host.code, "Alumno 1")
        c.next<Welcome>()
        // Un mensaje que el anfitrion contesta: pedir control siendo participante lo niega con un aviso.
        c.send(ControlRequest(target = "nadie"))
        val n = c.next<Notice>()
        assertTrue(n.text.isNotBlank())
    }
}
