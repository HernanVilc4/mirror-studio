package com.mirrorstudio.app.presentation.join

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.mirrorstudio.app.domain.JoinMeetingUseCase.Field
import com.mirrorstudio.app.presentation.theme.Ms
import com.mirrorstudio.app.presentation.ui.Callout
import com.mirrorstudio.app.presentation.ui.Ic
import com.mirrorstudio.app.presentation.ui.MsButton
import com.mirrorstudio.app.presentation.ui.MsField
import com.mirrorstudio.app.presentation.ui.ScreenHeader
import com.mirrorstudio.app.presentation.ui.Tone

/** Pantalla 04 (y 13, 32 como estados de error). */
@Composable
fun JoinScreen(viewModel: JoinViewModel, onBack: () -> Unit) {
    val s by viewModel.state.collectAsStateWithLifecycle()
    Column(Modifier.fillMaxSize().background(Ms.Bg).safeDrawingPadding().imePadding()) {
        ScreenHeader("Unirse con IP y código", onBack)
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Text("Pídele al anfitrión la IP y el código que ve en su sala.", style = MaterialTheme.typography.bodyLarge, color = Ms.Muted)
            Row {
                MsField(
                    "IP de la PC anfitriona", s.host, viewModel::onHost, Modifier.weight(1f),
                    error = s.fieldError?.takeIf { it.first == Field.HOST }?.second,
                    placeholder = "192.168.1.20", keyboard = KeyboardType.Uri, enabled = !s.busy
                )
                Spacer(Modifier.width(10.dp))
                MsField(
                    "Puerto", s.port, viewModel::onPort, Modifier.width(92.dp),
                    error = s.fieldError?.takeIf { it.first == Field.PORT }?.second,
                    keyboard = KeyboardType.Number, enabled = !s.busy
                )
            }
            MsField(
                "Código de la reunión", s.code, viewModel::onCode,
                error = s.fieldError?.takeIf { it.first == Field.CODE }?.second,
                hint = "8 caracteres, sin 0, 1, I ni O. Se escribe sin el guion.",
                placeholder = "K7M2-QX9P", keyboard = KeyboardType.Ascii, caps = KeyboardCapitalization.Characters,
                mono = true, enabled = !s.busy, visualTransformation = com.mirrorstudio.app.presentation.ui.CodeVisualTransformation
            )
            MsField(
                "Tu nombre", s.name, viewModel::onName,
                error = s.fieldError?.takeIf { it.first == Field.NAME }?.second,
                caps = KeyboardCapitalization.Words, imeAction = ImeAction.Go, onIme = viewModel::submit, enabled = !s.busy
            )
            AnimatedVisibility(s.versionMismatch, enter = fadeIn() + expandVertically()) {
                Callout(
                    "La PC del docente tiene otra versión de MirrorStudio. Actualicen la app de la PC y la del teléfono a la misma versión.",
                    tone = Tone.Warn, title = "Versiones distintas"
                )
            }
            AnimatedVisibility(s.error != null, enter = fadeIn() + expandVertically()) {
                Callout(s.error.orEmpty(), icon = Ic.WifiOff)
            }
            JoinButton(s.busy, viewModel::submit)
        }
    }
}

/**
 * «Entrar»: mientras se conecta se llena como una barra de progreso. El saludo tarda lo que tarde PBKDF2 en el
 * telefono (de 0,2 a 2 s), asi que la barra avanza rapido al principio y se frena cerca del final.
 */
@Composable
fun JoinButton(busy: Boolean, onClick: () -> Unit, text: String = "Entrar") {
    val fill = remember { Animatable(0f) }
    LaunchedEffect(busy) {
        if (busy) { fill.snapTo(0.05f); fill.animateTo(0.92f, tween(2200, easing = LinearOutSlowInEasing)) } else fill.snapTo(0f)
    }
    MsButton(
        if (busy) "Conectando…" else text, onClick, Modifier.fillMaxWidth().padding(top = 4.dp),
        trailing = if (busy) null else Ic.Arrow, large = true, progress = if (busy) fill.value else null
    )
    Spacer(Modifier.height(8.dp))
}
