package com.mirrorstudio.protocol

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import java.security.SecureRandom
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.test.fail

/**
 * Decision A4: los vectores que genera packages/protocol (TypeScript) se reproducen aqui. Si el protocolo cambia
 * en un lado y no en el otro, falla esta prueba en vez de la clase.
 */
class VectorsTest {
    private val dir: File = generateSequence(File("").absoluteFile) { it.parentFile }
        .map { File(it, "packages/protocol/vectors") }.first { it.isDirectory }
    private val plain = Json { ignoreUnknownKeys = false }
    private fun load(name: String) = plain.parseToJsonElement(File(dir, name).readText()).jsonObject
    private val areas = listOf("session", "control", "pairing", "slides", "pointer-ink", "messaging", "hand", "polls", "files", "media")

    @Test fun `la version coincide`() {
        assertEquals(PROTOCOL_VERSION, load("session.json")["protocolVersion"]!!.jsonPrimitive.int)
    }

    @Test fun `todo mensaje valido del anfitrion se entiende`() {
        var n = 0
        for (area in areas) for (case in load("$area.json")["valid"]!!.jsonArray.map { it.jsonObject }) {
            if (case["dir"]!!.jsonPrimitive.content != "server") continue
            val text = case["message"].toString()
            assertNotNull(Wire.parseServer(text), "$area / ${case["name"]}: $text")
            n++
        }
        assertTrue(n > 20, "solo $n mensajes del anfitrion")
    }

    @Test fun `todo mensaje valido del cliente se escribe igual que en TypeScript`() {
        var n = 0
        for (area in areas) for (case in load("$area.json")["valid"]!!.jsonArray.map { it.jsonObject }) {
            if (case["dir"]!!.jsonPrimitive.content != "client") continue
            val msg = case["message"]!!
            val expected = case["parsed"] ?: msg
            val decoded = runCatching { Wire.json.decodeFromString(ClientMessage.serializer(), msg.toString()) }
                .getOrElse { fail("$area / ${case["name"]}: no se pudo leer $msg (${it.message})") }
            val again = Wire.json.parseToJsonElement(Wire.encode(decoded))
            assertEquals(normalize(expected), normalize(again), "$area / ${case["name"]}")
            n++
        }
        assertTrue(n > 30, "solo $n mensajes del cliente")
    }

    @Test fun `los trozos de archivo coinciden byte a byte`() {
        val frames = load("files.json")["frames"]!!.jsonObject
        for (v in frames["valid"]!!.jsonArray.map { it.jsonObject }) {
            val payload = hex(v["payloadHex"]!!.jsonPrimitive.content)
            val frame = hex(v["frameHex"]!!.jsonPrimitive.content)
            val id = v["fileId"]!!.jsonPrimitive.int; val index = v["index"]!!.jsonPrimitive.int; val count = v["count"]!!.jsonPrimitive.int
            assertContentEquals(frame, encodeFileChunk(id, index, count, payload), v["name"].toString())
            val p = assertNotNull(parseFileChunk(frame))
            assertEquals(id, p.fileId); assertEquals(index, p.index); assertEquals(count, p.count)
            assertContentEquals(payload, p.payload)
        }
        for (v in frames["invalid"]!!.jsonArray.map { it.jsonObject }) {
            assertNull(parseFileChunk(hex(v["frameHex"]!!.jsonPrimitive.content)), "${v["name"]}: ${v["why"]}")
        }
    }

    @Test fun `el saludo completo da las mismas claves y pruebas`() {
        val h = load("handshake.json")
        val inp = h["inputs"]!!.jsonObject
        val d = h["derived"]!!.jsonObject
        val msgs = h["messages"]!!.jsonObject
        fun s(o: JsonObject, k: String) = o[k]!!.jsonPrimitive.content

        val hs = ClientHandshake(
            normalizeCode(s(inp, "code")), s(inp, "name"), inp["iterations"]!!.jsonPrimitive.int, SecureRandom(),
            fixedPrivateKey = hex(s(inp, "clientPrivateKey")), fixedNonce = unb64(s(inp, "clientNonceB64"))
        )
        val hello = Wire.json.parseToJsonElement(Wire.encodeHello(hs.hello()))
        assertEquals(normalize(msgs["hello"]!!), normalize(hello))

        val reply = Wire.parseHelloReply(msgs["helloReply"].toString())!!
        val confirm = hs.onReply(reply)!!
        assertEquals(s(d, "transcript"), toHex(hs.debugTranscript!!))
        val (send, recv, conf) = hs.debugKeys
        assertEquals(s(d, "c2hKey"), toHex(send!!))
        assertEquals(s(d, "h2cKey"), toHex(recv!!))
        assertEquals(s(d, "confirmKey"), toHex(conf!!))
        assertEquals(s(d, "clientMac"), confirm.mac)
        assertEquals(normalize(msgs["confirm"]!!), normalize(Wire.json.parseToJsonElement(Wire.encodeConfirm(confirm))))

        val channel = assertNotNull(hs.verifyOk(Wire.parseConfirmOk(msgs["confirmOk"].toString())!!))
        for (f in h["sealed"]!!.jsonArray.map { it.jsonObject }) {
            val frame = hex(s(f, "frameHex"))
            if (s(f, "direction") == "client->host") assertContentEquals(frame, channel.seal(s(f, "plaintext")))
            else assertEquals(s(f, "plaintext"), channel.openText(frame))
        }
    }

    /** Numeros como valor (1 y 1.0 son lo mismo) y sin campos nulos. */
    private fun normalize(e: JsonElement): JsonElement = when (e) {
        is JsonObject -> JsonObject(e.filterValues { it !is JsonNull }.mapValues { normalize(it.value) })
        is JsonArray -> JsonArray(e.map(::normalize))
        is JsonPrimitive -> if (!e.isString && e.booleanOrNull == null) JsonPrimitive(e.doubleOrNull) else e
        else -> e
    }

    private fun hex(s: String) = ByteArray(s.length / 2) { s.substring(it * 2, it * 2 + 2).toInt(16).toByte() }
}
