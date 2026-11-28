package com.mirrorstudio.network

import com.mirrorstudio.protocol.ClientHandshake
import com.mirrorstudio.protocol.FILE_TAG
import com.mirrorstudio.protocol.FileChunk
import com.mirrorstudio.protocol.parseFileChunk
import com.mirrorstudio.protocol.ClientMessage
import com.mirrorstudio.protocol.Leave
import com.mirrorstudio.protocol.PBKDF2_ITERATIONS
import com.mirrorstudio.protocol.SecureChannel
import com.mirrorstudio.protocol.ServerMessage
import com.mirrorstudio.protocol.Wire
import com.mirrorstudio.protocol.normalizeCode
import io.ktor.client.HttpClient
import io.ktor.client.HttpClientConfig
import io.ktor.client.engine.HttpClientEngineFactory
import io.ktor.client.plugins.websocket.DefaultClientWebSocketSession
import io.ktor.client.plugins.websocket.WebSockets
import io.ktor.client.plugins.websocket.webSocketSession
import io.ktor.websocket.CloseReason
import io.ktor.websocket.Frame
import io.ktor.websocket.close
import io.ktor.websocket.readBytes
import io.ktor.websocket.readText
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.channels.ClosedReceiveChannelException
import kotlinx.coroutines.channels.ReceiveChannel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout

/** Error al unirse, con un mensaje listo para mostrar a la persona. */
class JoinException(message: String, cause: Throwable? = null) : Exception(message, cause)

const val VERSION_MISMATCH = "Esta PC y el anfitrión tienen versiones distintas de MirrorStudio. Actualicen todas las PCs a la misma versión."
private const val MEDIA_TAG: Byte = 0x01

/** Cliente HTTP con WebSockets para cualquier motor de Ktor (OkHttp en Android, CIO en las pruebas, Darwin en iOS). */
fun meetingHttpClient(engine: HttpClientEngineFactory<*>, block: HttpClientConfig<*>.() -> Unit = {}): HttpClient =
    HttpClient(engine) {
        install(WebSockets)
        block()
    }

/**
 * Una reunion abierta con el anfitrion. Los mensajes llegan en orden por [incoming] (uno solo los consume: el
 * repositorio de la app) y [closed] se completa con el motivo cuando la conexion termina por cualquier razon.
 */
class MeetingConnection private constructor(
    private val session: DefaultClientWebSocketSession,
    private val channel: SecureChannel
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val queue = Channel<ServerMessage>(Channel.UNLIMITED)
    private val fileQueue = Channel<FileChunk>(Channel.UNLIMITED)
    /** Trozos de archivos que pedi con `file-get`, en orden. */
    val files: ReceiveChannel<FileChunk> get() = fileQueue
    private val closedReason = CompletableDeferred<String>()
    @Volatile private var leaving = false

    val incoming: ReceiveChannel<ServerMessage> get() = queue
    val closed: Deferred<String> get() = closedReason

    private fun start() {
        scope.launch {
            var reason = "Conexión cerrada"
            try {
                for (frame in session.incoming) {
                    if (frame !is Frame.Binary) continue                 // despues del saludo todo va cifrado y binario
                    val plain = channel.open(frame.readBytes())
                    if (plain == null) { reason = "Mensaje inválido del anfitrión"; break }
                    if (plain.isNotEmpty() && plain[0] == MEDIA_TAG) continue  // video del rele TCP: el telefono usa WebRTC
                    if (plain.isNotEmpty() && plain[0] == FILE_TAG) {
                        val chunk = parseFileChunk(plain)
                        if (chunk == null) { reason = "Archivo dañado del anfitrión"; break }
                        fileQueue.send(chunk); continue
                    }
                    Wire.parseServer(plain.toString(Charsets.UTF_8))?.let { queue.send(it) }
                }
            } catch (e: Exception) {
                reason = "Se perdió la conexión con el anfitrión"
            } finally {
                queue.close()
                fileQueue.close()
                closedReason.complete(if (leaving) "Saliste de la reunión" else reason)
                runCatching { session.close() }
            }
        }
    }

    suspend fun send(message: ClientMessage) {
        session.send(Frame.Binary(true, channel.seal(Wire.encode(message))))
    }

    /** Un trozo de archivo ya armado con [com.mirrorstudio.protocol.encodeFileChunk]. Espera si el socket esta lleno. */
    suspend fun sendBinary(frame: ByteArray) {
        session.send(Frame.Binary(true, channel.seal(frame)))
    }

    /** Como en el escritorio: avisa con `leave` y cierra el socket el propio cliente. */
    suspend fun leave() {
        leaving = true
        runCatching { send(Leave) }
        runCatching { session.close(CloseReason(CloseReason.Codes.NORMAL, "")) }
        closedReason.complete("Saliste de la reunión")
        scope.cancel()
    }

    companion object {
        /**
         * Se une a la reunion de [host]:[port]. El saludo deriva la clave del codigo (PBKDF2, 200 000 iteraciones):
         * se hace fuera del hilo principal. Lanza [JoinException] con el motivo para mostrar.
         */
        suspend fun connect(
            client: HttpClient, host: String, port: Int, code: String, name: String,
            iterations: Int = PBKDF2_ITERATIONS, timeoutMs: Long = 15_000
        ): MeetingConnection {
            val session = try {
                client.webSocketSession(host = host, port = port, path = "/")
            } catch (e: Exception) {
                throw JoinException("No se pudo conectar con $host:$port. ¿Está abierta la reunión y permite el firewall el puerto $port?", e)
            }
            val hs = ClientHandshake(normalizeCode(code), name.take(64), iterations)
            try {
                val channel = withTimeout(timeoutMs) {
                    session.send(Frame.Text(Wire.encodeHello(hs.hello())))
                    var result: SecureChannel? = null
                    while (result == null) {
                        val frame = session.incoming.receive()
                        if (frame !is Frame.Text) continue
                        val text = frame.readText()
                        when (Wire.messageType(text)) {
                            "hello-reply" -> {
                                val reply = Wire.parseHelloReply(text) ?: throw JoinException("Respuesta inválida del anfitrión")
                                val confirm = withContext(Dispatchers.Default) { hs.onReply(reply) }
                                    ?: throw JoinException("Respuesta inválida del anfitrión")
                                session.send(Frame.Text(Wire.encodeConfirm(confirm)))
                            }
                            "confirm-ok" -> result = Wire.parseConfirmOk(text)?.let { hs.verifyOk(it) }
                                ?: throw JoinException("El anfitrión no pudo demostrar que conoce el código. No te conectes.")
                            "reject" -> throw JoinException(Wire.parseReject(text)?.reason ?: "El anfitrión rechazó la conexión")
                            else -> throw JoinException("Mensaje inesperado del anfitrión")
                        }
                    }
                    result
                }
                return MeetingConnection(session, channel).also { it.start() }
            } catch (e: JoinException) {
                runCatching { session.close() }
                throw e
            } catch (e: ClosedReceiveChannelException) {
                // Un anfitrion de otra version no entiende el saludo y cierra con 4400 sin decir nada.
                val code = runCatching { session.closeReason.await()?.code }.getOrNull()
                throw JoinException(if (code?.toInt() == 4400) VERSION_MISMATCH else "Conexión cerrada antes de entrar")
            } catch (e: kotlinx.coroutines.TimeoutCancellationException) {
                runCatching { session.close() }
                throw JoinException("El anfitrión no respondió")
            }
        }
    }
}
