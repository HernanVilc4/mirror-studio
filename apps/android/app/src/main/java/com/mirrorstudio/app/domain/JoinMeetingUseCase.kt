package com.mirrorstudio.app.domain

import com.mirrorstudio.protocol.isValidCode
import com.mirrorstudio.protocol.normalizeCode

/** Valida lo que escribio la persona y, si esta bien, se une y recuerda los datos. */
class JoinMeetingUseCase(
    private val repository: MeetingRepository,
    private val preferences: JoinPreferences
) {
    sealed interface Result {
        data object Joined : Result
        data class Invalid(val field: Field, val message: String) : Result
        data class Failed(val message: String) : Result
    }

    enum class Field { HOST, PORT, CODE, NAME }

    suspend operator fun invoke(host: String, port: String, code: String, name: String): Result {
        val h = host.trim()
        if (!isHost(h)) return Result.Invalid(Field.HOST, "Escribe la IP de la PC del docente, por ejemplo 192.168.1.20")
        val p = port.trim().toIntOrNull()
        if (p == null || p !in 1..65535) return Result.Invalid(Field.PORT, "Puerto no válido")
        if (!isValidCode(code)) return Result.Invalid(Field.CODE, "El código tiene 8 caracteres, como K7Q4-M2XP")
        val n = name.trim()
        if (n.isEmpty()) return Result.Invalid(Field.NAME, "Escribe tu nombre")
        if (n.length > 64) return Result.Invalid(Field.NAME, "Nombre demasiado largo")

        val request = JoinRequest(h, p, normalizeCode(code), n)
        val error = repository.join(request) ?: run {
            preferences.save(request)
            return Result.Joined
        }
        return Result.Failed(error)
    }

    private fun isHost(s: String): Boolean {
        if (s.isEmpty() || s.any { it.isWhitespace() }) return false
        val parts = s.split('.')
        if (parts.size == 4 && parts.all { it.isNotEmpty() && it.all(Char::isDigit) }) return parts.all { it.toInt() in 0..255 }
        return s.all { it.isLetterOrDigit() || it == '-' || it == '.' } // nombre de equipo de la red
    }
}
