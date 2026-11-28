package com.mirrorstudio.protocol

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class UnitTest {
    @Test fun `la lista se escribe igual que JSON stringify de JavaScript`() {
        assertEquals("""["a","b\"c","é","\n","\u0001","\\"]""", jsonStringifyStrings(listOf("a", "b\"c", "é", "\n", "\u0001", "\\")))
        assertEquals("[]", jsonStringifyStrings(emptyList()))
        assertEquals("""["😀"]""", jsonStringifyStrings(listOf("😀")))
    }

    @Test fun `el codigo se normaliza y valida como en el escritorio`() {
        assertEquals("K7M2QX9P", normalizeCode("k7m2-qx9p"))
        assertTrue(isValidCode("K7M2-QX9P"))
        assertFalse(isValidCode("K7M2-QX9O")) // la O no existe en el alfabeto
        assertEquals("K7M2-QX9P", formatCode("K7M2QX9P"))
    }

    @Test fun `HKDF coincide con el vector 1 del RFC 5869`() {
        val okm = hkdfSha256(ByteArray(22) { 0x0b }, (0..12).map { it.toByte() }.toByteArray(), (0xf0..0xf9).map { it.toByte() }.toByteArray(), 42)
        assertEquals("3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865", toHex(okm))
    }

    @Test fun `el canal cifrado rechaza tramas repetidas o alteradas`() {
        val k1 = ByteArray(32) { 1 }; val k2 = ByteArray(32) { 2 }
        val a = SecureChannel(k1, k2); val b = SecureChannel(k2, k1)
        val f1 = a.seal("hola"); val f2 = a.seal("adios")
        assertEquals("hola", b.openText(f1))
        assertNull(b.open(f1)) // repetida
        val bad = f2.copyOf().also { it[it.size - 1] = (it[it.size - 1] + 1).toByte() }
        assertNull(b.open(bad)) // alterada
        assertEquals("adios", b.openText(f2))
    }

    @Test fun `los mensajes se escriben como los espera zod`() {
        assertEquals("""{"t":"leave"}""", Wire.encode(Leave))
        assertEquals("""{"t":"media-mode","relay":true}""", Wire.encode(MediaMode()))
        assertEquals("""{"t":"control-input","target":"x","input":{"t":"mouse-move","x":0.5,"y":0.25}}""", Wire.encode(ControlSend("x", MouseMove(0.5, 0.25))))
        assertNull(Wire.parseServer("""{"t":"algo-nuevo","x":1}""")) // un tipo nuevo se ignora sin caerse
        val st = Wire.parseServer("""{"t":"state","state":{"sessionId":"s","name":"Clase","participants":[{"id":"a","name":"Ana","role":"creator","host":true,"hand":null}],"presenter":null,"controls":[]}}""")
        assertTrue(st is StateMsg && st.state.participants.single().role == Role.CREATOR)
    }
}
