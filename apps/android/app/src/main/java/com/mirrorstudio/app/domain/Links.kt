package com.mirrorstudio.app.domain

import com.mirrorstudio.protocol.DEFAULT_PORT
import com.mirrorstudio.protocol.isValidCode
import com.mirrorstudio.protocol.normalizeCode
import java.net.URI
import java.net.URLDecoder

/** Lo que trae un QR o enlace `mirrorstudio://join?ip=…&port=…&code=…&v=5` (o `pair`, con `token`). */
data class MeetingLink(
    val kind: Kind,
    val host: String,
    val port: Int,
    val code: String,
    val version: Int?,
    val token: String? = null
) {
    enum class Kind { JOIN, PAIR }

    companion object {
        /** Null si no es un enlace de MirrorStudio valido. Nunca lanza. */
        fun parse(text: String): MeetingLink? = runCatching {
            val uri = URI(text.trim())
            if (!uri.scheme.equals("mirrorstudio", ignoreCase = true)) return null
            val kind = when (uri.host?.lowercase() ?: uri.schemeSpecificPart.substringBefore('?').trim('/').lowercase()) {
                "join" -> Kind.JOIN
                "pair" -> Kind.PAIR
                else -> return null
            }
            val q = (uri.rawQuery ?: "").split('&').filter { '=' in it }.associate {
                URLDecoder.decode(it.substringBefore('='), "UTF-8") to URLDecoder.decode(it.substringAfter('='), "UTF-8")
            }
            val host = q["ip"]?.trim().orEmpty()
            val code = q["code"].orEmpty()
            if (host.isEmpty() || !isValidCode(code)) return null
            val port = q["port"]?.toIntOrNull()?.takeIf { it in 1..65535 } ?: DEFAULT_PORT
            val token = q["token"]?.takeIf { it.isNotBlank() }
            if (kind == Kind.PAIR && token == null) return null
            MeetingLink(kind, host, port, normalizeCode(code), q["v"]?.toIntOrNull(), token)
        }.getOrNull()
    }
}
