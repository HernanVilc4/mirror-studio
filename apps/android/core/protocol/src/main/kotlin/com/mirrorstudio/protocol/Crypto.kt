package com.mirrorstudio.protocol

import org.bouncycastle.math.ec.rfc7748.X25519
import java.io.ByteArrayOutputStream
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import javax.crypto.Mac
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec

// Mismas primitivas que packages/protocol/src/node.ts: PBKDF2-SHA256, HKDF-SHA256, X25519, HMAC-SHA256.

const val PBKDF2_ITERATIONS = 200_000

internal fun b64(b: ByteArray): String = Base64.getEncoder().encodeToString(b)
internal fun unb64(s: String): ByteArray = Base64.getDecoder().decode(s)

/** PBKDF2-HMAC-SHA256(codigo normalizado, sal, iteraciones) de 32 bytes. El codigo nunca viaja por la red. */
fun deriveCodeKey(code: String, saltB64: String, iterations: Int = PBKDF2_ITERATIONS): ByteArray {
    val spec = PBEKeySpec(normalizeCode(code).toCharArray(), unb64(saltB64), iterations, 256)
    return try {
        SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded
    } finally {
        spec.clearPassword()
    }
}

fun hmacSha256(key: ByteArray, vararg parts: ByteArray): ByteArray {
    val mac = Mac.getInstance("HmacSHA256")
    mac.init(SecretKeySpec(key, "HmacSHA256"))
    for (p in parts) mac.update(p)
    return mac.doFinal()
}

/** HKDF (RFC 5869) con SHA-256, igual que `hkdfSync('sha256', ikm, salt, info, length)` de Node. */
fun hkdfSha256(ikm: ByteArray, salt: ByteArray, info: ByteArray, length: Int): ByteArray {
    val prk = hmacSha256(if (salt.isEmpty()) ByteArray(32) else salt, ikm)
    val out = ByteArrayOutputStream()
    var t = ByteArray(0)
    var i = 1
    while (out.size() < length) {
        t = hmacSha256(prk, t, info, byteArrayOf(i.toByte()))
        out.write(t)
        i++
    }
    return out.toByteArray().copyOf(length)
}

/** Par de claves X25519 efimero (RFC 7748), con la implementacion de BouncyCastle: no depende del proveedor de Android. */
class X25519KeyPair private constructor(private val priv: ByteArray) {
    constructor(random: SecureRandom = SecureRandom()) : this(ByteArray(32).also { X25519.generatePrivateKey(random, it) })

    companion object {
        /** Solo para los vectores de prueba: clave privada fija. */
        fun fromPrivate(raw: ByteArray): X25519KeyPair = X25519KeyPair(raw.copyOf())
    }

    val publicKey = ByteArray(32).also { X25519.generatePublicKey(priv, 0, it, 0) }

    /** Secreto compartido, o null si la clave del otro lado no es valida (punto de orden bajo). */
    fun agree(peerPublic: ByteArray): ByteArray? {
        if (peerPublic.size != 32) return null
        val out = ByteArray(32)
        return if (X25519.calculateAgreement(priv, 0, peerPublic, 0, out, 0)) out else null
    }
}

fun sha256(vararg parts: ByteArray): ByteArray {
    val md = MessageDigest.getInstance("SHA-256")
    for (p in parts) md.update(p)
    return md.digest()
}

fun randomBytes(n: Int, random: SecureRandom = SecureRandom()): ByteArray = ByteArray(n).also { random.nextBytes(it) }

fun toHex(b: ByteArray): String {
    val sb = StringBuilder(b.size * 2)
    for (x in b) sb.append("0123456789abcdef"[(x.toInt() shr 4) and 15]).append("0123456789abcdef"[x.toInt() and 15])
    return sb.toString()
}

/** Igual que `JSON.stringify` de JavaScript para una lista de cadenas: el anfitrion firma ese texto exacto. */
fun jsonStringifyStrings(items: List<String>): String {
    val sb = StringBuilder("[")
    items.forEachIndexed { idx, s ->
        if (idx > 0) sb.append(',')
        sb.append('"')
        var i = 0
        while (i < s.length) {
            val c = s[i]
            when {
                c == '"' -> sb.append("\\\"")
                c == '\\' -> sb.append("\\\\")
                c == '\b' -> sb.append("\\b")
                c == '\u000c' -> sb.append("\\f")
                c == '\n' -> sb.append("\\n")
                c == '\r' -> sb.append("\\r")
                c == '\t' -> sb.append("\\t")
                c < ' ' -> sb.append("\\u").append("%04x".format(c.code))
                // Un sustituto suelto (mitad de un emoji) se escribe escapado, como hace JSON.stringify
                c.isHighSurrogate() && i + 1 < s.length && s[i + 1].isLowSurrogate() -> { sb.append(c).append(s[i + 1]); i++ }
                c.isSurrogate() -> sb.append("\\u").append("%04x".format(c.code))
                else -> sb.append(c)
            }
            i++
        }
        sb.append('"')
    }
    return sb.append(']').toString()
}
