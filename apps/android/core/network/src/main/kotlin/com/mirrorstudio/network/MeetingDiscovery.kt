package com.mirrorstudio.network

import com.mirrorstudio.protocol.DEFAULT_PORT
import com.mirrorstudio.protocol.Wire
import io.ktor.client.HttpClient
import io.ktor.client.plugins.websocket.webSocketSession
import io.ktor.websocket.Frame
import io.ktor.websocket.close
import io.ktor.websocket.readText
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import java.net.InetSocketAddress
import java.net.Socket

/** Una reunion que respondio en la red. [version] distinta de la nuestra se muestra como «version distinta». */
data class FoundMeeting(val ip: String, val port: Int, val name: String, val host: String, val participants: Int, val version: Int)

/**
 * Busca reuniones en la subred del telefono, como `scanLan` del escritorio: primero mira que puertos 47800
 * estan abiertos (rapido, en paralelo) y solo a esos les pregunta `info`. Sirve dentro de la misma subred; para
 * el resto del campus se entra con el QR o el enlace.
 */
class MeetingDiscovery(private val http: HttpClient) {

    suspend fun scan(ownIp: String, prefixLength: Int, port: Int = DEFAULT_PORT): List<FoundMeeting> = coroutineScope {
        val hosts = subnetHosts(ownIp, prefixLength)
        val gate = Semaphore(64)
        val open = hosts.map { ip -> async(Dispatchers.IO) { gate.withPermit { if (isOpen(ip, port)) ip else null } } }.awaitAll().filterNotNull()
        open.map { ip -> async { probe(ip, port) } }.awaitAll().filterNotNull().sortedBy { it.name.lowercase() }
    }

    /** Pide la informacion publica de una reunion (nombre, anfitrion, personas). Null si no responde. */
    suspend fun probe(ip: String, port: Int = DEFAULT_PORT, timeoutMs: Long = 1500): FoundMeeting? = withTimeoutOrNull(timeoutMs) {
        val s = runCatching { http.webSocketSession(host = ip, port = port, path = "/") }.getOrNull() ?: return@withTimeoutOrNull null
        try {
            s.send(Frame.Text("""{"t":"info"}"""))
            val f = s.incoming.receive() as? Frame.Text ?: return@withTimeoutOrNull null
            Wire.parseInfoReply(f.readText())?.let { FoundMeeting(ip, port, it.name, it.host, it.participants, it.v) }
        } catch (e: Exception) {
            null
        } finally {
            runCatching { s.close() }
        }
    }

    private suspend fun isOpen(ip: String, port: Int): Boolean = withContext(Dispatchers.IO) {
        runCatching { Socket().use { it.connect(InetSocketAddress(ip, port), 400); true } }.getOrDefault(false)
    }

    companion object {
        /** Direcciones de la subred sin la propia; como mucho una /24 alrededor del telefono (254 direcciones). */
        fun subnetHosts(ip: String, prefixLength: Int): List<String> {
            val parts = ip.split('.').mapNotNull { it.toIntOrNull() }
            if (parts.size != 4) return emptyList()
            val addr = parts.fold(0L) { acc, p -> (acc shl 8) or p.toLong() }
            val prefix = prefixLength.coerceIn(24, 30)
            val mask = (0xFFFFFFFFL shl (32 - prefix)) and 0xFFFFFFFFL
            val net = addr and mask
            val count = 1L shl (32 - prefix)
            return (1 until count - 1).map { net + it }.filter { it != addr }.map { a ->
                listOf(24, 16, 8, 0).joinToString(".") { ((a shr it) and 0xFF).toString() }
            }
        }
    }
}
