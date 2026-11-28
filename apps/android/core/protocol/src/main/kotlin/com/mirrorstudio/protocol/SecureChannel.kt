package com.mirrorstudio.protocol

import java.nio.ByteBuffer
import java.nio.ByteOrder
import javax.crypto.AEADBadTagException
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * AES-256-GCM: [contador de 8 bytes][texto cifrado][etiqueta de 16 bytes]. Los contadores deben llegar en orden exacto.
 * Mismo formato que SecureChannel de packages/protocol/src/node.ts.
 */
class SecureChannel(private val sendKey: ByteArray, private val recvKey: ByteArray) {
    private var out = 0L
    private var inn = 0L

    private fun nonce(n: Long): ByteArray {
        val b = ByteArray(12)
        ByteBuffer.wrap(b).order(ByteOrder.BIG_ENDIAN).putLong(4, n)
        return b
    }

    @Synchronized
    fun seal(plain: ByteArray): ByteArray {
        val n = out++
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, SecretKeySpec(sendKey, "AES"), GCMParameterSpec(128, nonce(n)))
        val ct = c.doFinal(plain) // el texto cifrado ya lleva la etiqueta al final
        return ByteBuffer.allocate(8 + ct.size).order(ByteOrder.BIG_ENDIAN).putLong(n).put(ct).array()
    }

    fun seal(text: String): ByteArray = seal(text.toByteArray(Charsets.UTF_8))

    /** Null si hubo manipulacion, repeticion, cambio de orden o recorte. Quien llama debe cerrar la conexion. */
    @Synchronized
    fun open(frame: ByteArray): ByteArray? {
        if (frame.size < 8 + 16) return null
        val n = ByteBuffer.wrap(frame, 0, 8).order(ByteOrder.BIG_ENDIAN).long
        if (n != inn) return null
        return try {
            val c = Cipher.getInstance("AES/GCM/NoPadding")
            c.init(Cipher.DECRYPT_MODE, SecretKeySpec(recvKey, "AES"), GCMParameterSpec(128, nonce(n)))
            val plain = c.doFinal(frame, 8, frame.size - 8)
            inn++
            plain
        } catch (_: AEADBadTagException) {
            null
        } catch (_: java.security.GeneralSecurityException) {
            null
        }
    }

    fun openText(frame: ByteArray): String? = open(frame)?.toString(Charsets.UTF_8)
}
