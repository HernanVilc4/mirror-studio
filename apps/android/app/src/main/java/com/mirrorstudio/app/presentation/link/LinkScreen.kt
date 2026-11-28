package com.mirrorstudio.app.presentation.link

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import com.mirrorstudio.app.domain.JoinMeetingUseCase
import com.mirrorstudio.app.domain.JoinPreferences
import com.mirrorstudio.app.domain.MeetingLink
import com.mirrorstudio.app.presentation.brand.BrandGlow
import com.mirrorstudio.app.presentation.brand.BrandMark
import com.mirrorstudio.app.presentation.join.JoinButton
import com.mirrorstudio.app.presentation.theme.Montserrat
import com.mirrorstudio.app.presentation.theme.Ms
import com.mirrorstudio.app.presentation.ui.BtnKind
import com.mirrorstudio.app.presentation.ui.Callout
import com.mirrorstudio.app.presentation.ui.Card
import com.mirrorstudio.app.presentation.ui.Ic
import com.mirrorstudio.app.presentation.ui.MsButton
import com.mirrorstudio.app.presentation.ui.MsField
import com.mirrorstudio.app.presentation.ui.Tone
import com.mirrorstudio.network.MeetingDiscovery
import com.mirrorstudio.network.VERSION_MISMATCH
import com.mirrorstudio.protocol.PROTOCOL_VERSION
import com.mirrorstudio.protocol.formatCode
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class LinkUiState(
    val meetingName: String? = null,
    val detail: String? = null,
    val unreachable: Boolean = false,
    val name: String = "",
    val busy: Boolean = false,
    val error: String? = null,
    val versionMismatch: Boolean = false
)

/** Pantalla 31: unirse desde un QR o enlace. Primero pregunta a la PC el nombre de la reunion. */
class LinkViewModel(
    private val link: MeetingLink,
    private val join: JoinMeetingUseCase,
    private val discovery: MeetingDiscovery,
    preferences: JoinPreferences,
    private val classroom: com.mirrorstudio.app.domain.ClassroomRepository
) : ViewModel() {
    private val _state = MutableStateFlow(LinkUiState(name = preferences.lastName(), versionMismatch = link.version != null && link.version != PROTOCOL_VERSION))
    val state: StateFlow<LinkUiState> = _state.asStateFlow()

    init {
        viewModelScope.launch {
            // El primer arranque tarda: se da mas tiempo y un segundo intento antes de decir que no responde.
            val info = discovery.probe(link.host, link.port, timeoutMs = 3000) ?: discovery.probe(link.host, link.port, timeoutMs = 3000)
            _state.update {
                if (info == null) it.copy(unreachable = true, detail = "${link.host}:${link.port}")
                else it.copy(
                    meetingName = info.name,
                    detail = "${info.host} · ${info.participants} ${if (info.participants == 1) "persona" else "personas"}",
                    versionMismatch = info.version != PROTOCOL_VERSION
                )
            }
        }
    }

    fun onName(v: String) = _state.update { it.copy(name = v.take(64), error = null) }

    fun submit() {
        if (_state.value.busy) return
        _state.update { it.copy(busy = true, error = null) }
        viewModelScope.launch {
            val r = join(link.host, link.port.toString(), link.code, _state.value.name)
            _state.update {
                when (r) {
                    JoinMeetingUseCase.Result.Joined -> {
                        // QR de vincular: despues de entrar se reclama el token (seccion 3).
                        link.token?.takeIf { link.kind == MeetingLink.Kind.PAIR }?.let { t -> viewModelScope.launch { classroom.pair(t) } }
                        it.copy(busy = false)
                    }
                    is JoinMeetingUseCase.Result.Invalid -> it.copy(busy = false, error = r.message)
                    is JoinMeetingUseCase.Result.Failed ->
                        if (r.message == VERSION_MISMATCH) it.copy(busy = false, versionMismatch = true) else it.copy(busy = false, error = r.message)
                }
            }
        }
    }
}

@Composable
fun LinkScreen(viewModel: LinkViewModel, link: MeetingLink, onCancel: () -> Unit) {
    val s by viewModel.state.collectAsStateWithLifecycle()
    Box(Modifier.fillMaxSize().background(Ms.Bg)) {
        BrandGlow(Modifier.fillMaxWidth().height(300.dp))
        Column(
            Modifier.fillMaxSize().safeDrawingPadding().imePadding().verticalScroll(rememberScrollState()).padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                BrandMark(28.dp)
                Spacer(Modifier.width(10.dp))
                Text("MirrorStudio", style = MaterialTheme.typography.titleMedium.copy(fontFamily = Montserrat))
            }
            Spacer(Modifier.height(16.dp))
            Text("Abierto desde un enlace", style = MaterialTheme.typography.labelMedium, color = Ms.Muted)
            Card(Modifier.fillMaxWidth()) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(44.dp).background(Ms.AccentSoft, RoundedCornerShape(12.dp)), contentAlignment = Alignment.Center) {
                        Icon(Ic.Monitor, null, tint = Ms.Accent, modifier = Modifier.size(22.dp))
                    }
                    Spacer(Modifier.width(12.dp))
                    Column {
                        Text(s.meetingName ?: if (s.unreachable) "Reunión sin respuesta" else "Buscando la reunión…", style = MaterialTheme.typography.titleMedium)
                        Text(s.detail ?: "${link.host} · código ${formatCode(link.code)}", style = MaterialTheme.typography.bodySmall, color = Ms.Muted)
                    }
                }
            }
            Text("El código viene en el enlace. No tienes que escribirlo.", style = MaterialTheme.typography.bodyMedium, color = Ms.Muted)
            AnimatedVisibility(s.unreachable, enter = fadeIn() + expandVertically()) {
                Callout("La PC no responde. Revisa que estés en la red de la universidad y que la reunión siga abierta.", tone = Tone.Warn, icon = Ic.WifiOff)
            }
            AnimatedVisibility(s.versionMismatch, enter = fadeIn() + expandVertically()) {
                Callout("La PC del docente tiene otra versión de MirrorStudio. Actualicen la app a la misma versión.", tone = Tone.Warn, title = "Versiones distintas")
            }
            AnimatedVisibility(s.error != null, enter = fadeIn() + expandVertically()) { Callout(s.error.orEmpty()) }
            MsField("Te verán como", s.name, viewModel::onName, caps = KeyboardCapitalization.Words, imeAction = ImeAction.Go, onIme = viewModel::submit)
            JoinButton(s.busy, viewModel::submit, text = "Unirme a la reunión")
            MsButton("Cancelar", onCancel, Modifier.fillMaxWidth(), kind = BtnKind.Ghost)
            Text("¿No es tu clase? Cierra esta pantalla; no se une nada hasta que lo pidas.", style = MaterialTheme.typography.bodySmall, color = Ms.Muted)
        }
    }
}
