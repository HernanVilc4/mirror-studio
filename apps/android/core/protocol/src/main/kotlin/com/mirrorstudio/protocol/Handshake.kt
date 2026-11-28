package com.mirrorstudio.protocol

import java.security.MessageDigest
import java.security.SecureRandom

/**
 * Lado cliente del intercambio de claves autenticado con el codigo (ver packages/protocol/src/node.ts):
 *  1. Se envian una clave X25519 efimera y un nonce. La sal de la sesion la pone el anfitrion.
 *  2. codeKey = PBKDF2(codigo, sal). El codigo nunca viaja.
 *  3. claves = HKDF(dh || codeKey, transcripcion). Cada trama posterior va con AES-256-GCM.
 *  4. Los dos lados prueban que conocen codeKey con un HMAC sobre la transcripcion completa.
 */
class ClientHandshake(
    private val code: String,
    private val name: String,
    private val iterations: Int = PBKDF2_ITERATIONS,
    random: SecureRandom = SecureRandom(),
    /** Solo para los vectores de prueba: clave privada y nonce fijos. */
    fixedPrivateKey: ByteArray? = null,
    fixedNonce: ByteArray? = null
) {
    private val keys = fixedPrivateKey?.let { X25519KeyPair.fromPrivate(it) } ?: X25519KeyPair(random)
    private val nonce = b64(fixedNonce ?: randomBytes(16, random))
    private var confirmKey: ByteArray? = null
    private var transcript: ByteArray? = null
    private var sendKey: ByteArray? = null
    private var recvKey: ByteArray? = null

    fun hello(): Hello = Hello(pub = b64(keys.publicKey), nonce = nonce, name = name)

    /** La confirmacion que hay que enviar, o null si la respuesta del anfitrion es invalida. */
    fun onReply(reply: HelloReply): Confirm? {
        val hostPub = try { unb64(reply.pub) } catch (_: IllegalArgumentException) { return null }
        val dh = keys.agree(hostPub) ?: return null
        val tr = sha256(
            "MS2".toByteArray(Charsets.UTF_8),
            jsonStringifyStrings(listOf(b64(keys.publicKey), reply.pub, nonce, reply.nonce, reply.salt, name)).toByteArray(Charsets.UTF_8)
        )
        val codeKey = deriveCodeKey(code, reply.salt, iterations)
        val okm = hkdfSha256(dh + codeKey, tr, "ms2-keys".toByteArray(Charsets.UTF_8), 96)
        sendKey = okm.copyOfRange(0, 32)      // cliente -> anfitrion
        recvKey = okm.copyOfRange(32, 64)     // anfitrion -> cliente
        confirmKey = okm.copyOfRange(64, 96)
        transcript = tr
        return Confirm(mac = mac("client"))
    }

    /** Comprueba la prueba del anfitrion. Solo entonces el canal es utilizable. */
    fun verifyOk(ok: ConfirmOk): SecureChannel? {
        if (confirmKey == null) return null
        val expected = mac("host").toByteArray(Charsets.UTF_8)
        if (!MessageDigest.isEqual(expected, ok.mac.toByteArray(Charsets.UTF_8))) return null
        return SecureChannel(sendKey!!, recvKey!!)
    }

    /** Valores intermedios, para comparar con handshake.json. */
    internal val debugTranscript get() = transcript
    internal val debugKeys get() = Triple(sendKey, recvKey, confirmKey)

    private fun mac(who: String): String =
        toHex(hmacSha256(confirmKey!!, who.toByteArray(Charsets.UTF_8), transcript!!))
}
