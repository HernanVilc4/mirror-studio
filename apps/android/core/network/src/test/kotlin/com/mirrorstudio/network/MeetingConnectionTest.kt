package com.mirrorstudio.network

import com.mirrorstudio.protocol.ControlRequest
import com.mirrorstudio.protocol.Notice
import com.mirrorstudio.protocol.TestHost
import com.mirrorstudio.protocol.Welcome
import com.mirrorstudio.protocol.formatCode
import io.ktor.client.engine.cio.CIO
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlin.system.measureTimeMillis
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertIs
import kotlin.test.assertTrue

class MeetingConnectionTest {
    private lateinit var host: TestHost
    private val http = meetingHttpClient(CIO)

    @BeforeTest fun start() { host = TestHost.start() }
    @AfterTest fun stop() { host.close(); http.close() }

    @Test fun `se une, recibe la bienvenida y sale`() = runBlocking {
        val conn: MeetingConnection
        val ms = measureTimeMillis { conn = MeetingConnection.connect(http, "127.0.0.1", host.port, formatCode(host.code), "Galaxy de Caleb") }
        println("Saludo completo (incluye PBKDF2 de 200 000 iteraciones) en $ms ms")
        val w = assertIs<Welcome>(withTimeout(10_000) { conn.incoming.receive() })
        assertTrue(w.state.participants.any { it.id == w.you && it.name == "Galaxy de Caleb" })
        conn.send(ControlRequest(target = "nadie"))
        withTimeout(10_000) { while (conn.incoming.receive() !is Notice) Unit }
        conn.leave()
        assertEquals("Saliste de la reunión", conn.closed.await())
    }

    @Test fun `un codigo incorrecto da un mensaje claro`() = runBlocking {
        val e = assertFailsWith<JoinException> { MeetingConnection.connect(http, "127.0.0.1", host.port, "ZZZZZZZZ", "Intruso") }
        assertEquals("Código incorrecto", e.message)
    }

    @Test fun `sin anfitrion explica que revise la reunion y el firewall`() = runBlocking {
        val e = assertFailsWith<JoinException> { MeetingConnection.connect(http, "127.0.0.1", 1, host.code, "Alguien") }
        assertTrue(e.message!!.contains("firewall"))
    }
}

class MeetingDiscoveryTest {
    @Test fun `la subred es una 24 sin la propia direccion`() {
        val h = MeetingDiscovery.subnetHosts("10.44.84.67", 24)
        assertEquals(253, h.size)
        assertEquals("10.44.84.1", h.first())
        assertEquals("10.44.84.254", h.last())
        assertTrue("10.44.84.67" !in h)
    }

    @Test fun `una red grande se recorta a la 24 del telefono`() {
        assertEquals(253, MeetingDiscovery.subnetHosts("172.16.5.9", 16).size)
    }

    @Test fun `encuentra un anfitrion real`() = runBlocking {
        TestHost.start().use { host ->
            meetingHttpClient(CIO).use { http ->
                val m = MeetingDiscovery(http).probe("127.0.0.1", host.port)
                assertEquals("Clase de prueba", m?.name)
                assertEquals("PC-Docente", m?.host)
            }
        }
    }
}
