package com.mirrorstudio.app.presentation.join

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.mirrorstudio.app.domain.JoinMeetingUseCase
import com.mirrorstudio.app.domain.JoinMeetingUseCase.Field
import com.mirrorstudio.app.domain.JoinPreferences
import com.mirrorstudio.network.VERSION_MISMATCH
import com.mirrorstudio.protocol.normalizeCode
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class JoinUiState(
    val host: String = "",
    val port: String = "",
    val code: String = "",
    val name: String = "",
    val busy: Boolean = false,
    val fieldError: Pair<Field, String>? = null,
    val error: String? = null,
    /** El anfitrion tiene otra version (pantalla 32). */
    val versionMismatch: Boolean = false
)

class JoinViewModel(
    private val join: JoinMeetingUseCase,
    preferences: JoinPreferences
) : ViewModel() {

    private val _state = MutableStateFlow(
        JoinUiState(host = preferences.lastHost(), port = preferences.lastPort().toString(), name = preferences.lastName())
    )
    val state: StateFlow<JoinUiState> = _state.asStateFlow()

    /** Datos que llegan de una reunion encontrada en la red o de un enlace. */
    fun prefill(host: String?, port: Int?, code: String? = null) = _state.update {
        it.copy(host = host ?: it.host, port = port?.toString() ?: it.port, code = code?.let(::clean) ?: it.code)
    }

    fun onHost(v: String) = _state.update { it.copy(host = v.trim(), fieldError = null, error = null, versionMismatch = false) }
    fun onPort(v: String) = _state.update { it.copy(port = v.filter(Char::isDigit).take(5), fieldError = null, error = null) }
    fun onName(v: String) = _state.update { it.copy(name = v.take(64), fieldError = null, error = null) }
    /** Acepta minusculas, espacios o guiones y lo muestra como K7Q4-M2XP. */
    fun onCode(v: String) = _state.update { it.copy(code = clean(v), fieldError = null, error = null) }

    /** Se guarda sin guion; la pantalla lo muestra como K7Q4-M2XP. */
    private fun clean(v: String): String = normalizeCode(v).take(8)

    fun submit() {
        val s = _state.value
        if (s.busy) return
        _state.update { it.copy(busy = true, fieldError = null, error = null, versionMismatch = false) }
        viewModelScope.launch {
            when (val r = join(s.host, s.port, s.code, s.name)) {
                JoinMeetingUseCase.Result.Joined -> _state.update { it.copy(busy = false, code = "") }
                is JoinMeetingUseCase.Result.Invalid -> _state.update { it.copy(busy = false, fieldError = r.field to r.message) }
                is JoinMeetingUseCase.Result.Failed -> _state.update {
                    when (r.message) {
                        // Pantalla 13: el error va en el campo del codigo.
                        "Código incorrecto" -> it.copy(busy = false, fieldError = Field.CODE to "Código incorrecto. Revísalo en la pantalla del docente.")
                        VERSION_MISMATCH -> it.copy(busy = false, versionMismatch = true)
                        else -> it.copy(busy = false, error = r.message)
                    }
                }
            }
        }
    }
}
