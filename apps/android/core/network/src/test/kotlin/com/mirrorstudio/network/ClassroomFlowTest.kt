package com.mirrorstudio.network

import com.mirrorstudio.protocol.FileAccept
import com.mirrorstudio.protocol.FileGet
import com.mirrorstudio.protocol.FileMeta
import com.mirrorstudio.protocol.FileOffer
import com.mirrorstudio.protocol.HandSend
import com.mirrorstudio.protocol.Msg
import com.mirrorstudio.protocol.MsgBody
import com.mirrorstudio.protocol.MsgHistory
import com.mirrorstudio.protocol.MsgSend
import com.mirrorstudio.protocol.MsgTo
import com.mirrorstudio.protocol.ServerMessage
import com.mirrorstudio.protocol.StateMsg
import com.mirrorstudio.protocol.TestHost
import com.mirrorstudio.protocol.Device
import com.mirrorstudio.protocol.Welcome
import com.mirrorstudio.protocol.encodeFileChunk
import com.mirrorstudio.protocol.sha256
import com.mirrorstudio.protocol.toHex
import io.ktor.client.engine.cio.CIO
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

/** Las funciones de aula de punta a punta contra la logica real del anfitrion (protocolo v5). */
class ClassroomFlowTest {
    private suspend inline fun <reified T : ServerMessage> MeetingConnection.next(crossinline ok: (T) -> Boolean = { true }): T =
        withTimeout(10_000) { while (true) { val m = incoming.receive(); if (m is T && ok(m)) return@withTimeout m } ; error("") }

    @Test fun `mano, chat de grupo y archivo de ida y vuelta`() = runBlocking {
        TestHost.start().use { host ->
            meetingHttpClient(CIO).use { http ->
                val a = MeetingConnection.connect(http, "127.0.0.1", host.port, host.code, "Teléfono A")
                val b = MeetingConnection.connect(http, "127.0.0.1", host.port, host.code, "Teléfono B")
                val meA = assertIs<Welcome>(a.incoming.receive()).you
                assertIs<Welcome>(b.incoming.receive())
                b.next<MsgHistory>()

                // El telefono se anuncia como telefono.
                val st = a.next<StateMsg> { s -> s.state.participants.size == 3 }
                assertEquals(Device.PHONE, st.state.participants.first { it.id == meA }.device)

                // Levantar la mano: queda primero en la fila.
                a.send(HandSend(true))
                a.next<StateMsg> { s -> s.state.participants.first { it.id == meA }.hand == 1 }

                // Chat de grupo: lo que A escribe a todos lo ve B.
                a.send(MsgSend(MsgTo.All, MsgBody.Text("Hola a todos")))
                val got = b.next<Msg> { it.body is MsgBody.Text }
                assertEquals(meA, got.from)

                // Archivo: oferta, trozos, mensaje; B lo descarga y llega igual.
                val data = ByteArray(70_000) { (it % 251).toByte() }
                a.send(FileOffer("guia.pdf", data.size.toLong(), toHex(sha256(data)), "application/pdf"))
                val id = a.next<FileAccept>().fileId
                a.sendBinary(encodeFileChunk(id, 0, 2, data.copyOfRange(0, 49152)))
                a.sendBinary(encodeFileChunk(id, 1, 2, data.copyOfRange(49152, data.size)))
                a.send(MsgSend(MsgTo.All, MsgBody.File(id)))
                val fm = b.next<Msg> { it.body is MsgBody.File }
                assertEquals("guia.pdf", (fm.body as MsgBody.File).name)
                b.send(FileGet(id))
                val meta = b.next<FileMeta>()
                assertEquals(data.size.toLong(), meta.size)
                val c0 = withTimeout(10_000) { b.files.receive() }
                val c1 = withTimeout(10_000) { b.files.receive() }
                assertContentEquals(data, c0.payload + c1.payload)
                assertTrue(c1.index == 1)
                a.leave(); b.leave()
            }
        }
    }
}
