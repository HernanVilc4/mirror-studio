package com.mirrorstudio.app.presentation.home

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.slideInVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.mirrorstudio.app.domain.NearbyMeeting
import com.mirrorstudio.app.presentation.brand.BrandGlow
import com.mirrorstudio.app.presentation.brand.BrandMark
import com.mirrorstudio.app.presentation.brand.LocalBrandAnchor
import com.mirrorstudio.app.presentation.brand.brandAnchor
import com.mirrorstudio.app.presentation.motion.Motion
import com.mirrorstudio.app.presentation.theme.DisplayStyle
import com.mirrorstudio.app.presentation.theme.Montserrat
import com.mirrorstudio.app.presentation.theme.Ms
import com.mirrorstudio.app.presentation.ui.BtnKind
import com.mirrorstudio.app.presentation.ui.Card
import com.mirrorstudio.app.presentation.ui.Ic
import com.mirrorstudio.app.presentation.ui.MsButton
import com.mirrorstudio.app.presentation.ui.MsField
import com.mirrorstudio.app.presentation.ui.RoundButton

/** Pantalla 02: nombre, escanear QR, unirse con IP y las reuniones de la red. */
@Composable
fun HomeScreen(
    viewModel: HomeViewModel,
    onScan: () -> Unit,
    onJoinIp: (ip: String?, port: Int?) -> Unit,
    onReplayIntro: () -> Unit = {}
) {
    val s by viewModel.state.collectAsStateWithLifecycle()
    var help by rememberSaveable { mutableStateOf(false) }

    Box(Modifier.fillMaxSize().background(Ms.Bg)) {
        BrandGlow(Modifier.fillMaxWidth().height(360.dp))
        Column(
            Modifier
                .fillMaxSize()
                .safeDrawingPadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp, vertical = 12.dp)
        ) {
            // Tocar el logo vuelve a mostrar la entrada animada.
            Row(
                Modifier.clip(androidx.compose.foundation.shape.RoundedCornerShape(12.dp)).clickable(onClick = onReplayIntro),
                verticalAlignment = Alignment.CenterVertically
            ) {
                BrandMark(32.dp, Modifier.brandAnchor(LocalBrandAnchor.current))
                Spacer(Modifier.width(10.dp))
                Text("MirrorStudio", style = MaterialTheme.typography.titleMedium.copy(fontFamily = Montserrat), modifier = Modifier.weight(1f))
                RoundButton(Ic.Shield, "Ayuda de red", { help = true })
            }
            Spacer(Modifier.height(40.dp))
            Text("Únete a una reunión", style = DisplayStyle)
            Spacer(Modifier.height(6.dp))
            Text("Ve la presentación y controla tu PC desde el teléfono.", style = MaterialTheme.typography.bodyLarge, color = Ms.Muted)
            Spacer(Modifier.height(24.dp))
            MsField(
                "Te verán como", s.name, viewModel::onName,
                caps = KeyboardCapitalization.Words, imeAction = ImeAction.Done,
                error = if (s.name.isBlank()) "Escribe tu nombre" else null
            )
            Spacer(Modifier.height(16.dp))
            MsButton("Escanear QR de la reunión", onScan, Modifier.fillMaxWidth(), icon = Ic.Qr, large = true)
            Spacer(Modifier.height(10.dp))
            MsButton("Unirse con IP y código", { onJoinIp(null, null) }, Modifier.fillMaxWidth(), kind = BtnKind.Secondary, icon = Ic.Keyboard)

            s.resume?.takeIf { it.compatible }?.let { r ->
                Spacer(Modifier.height(20.dp))
                Card(Modifier.fillMaxWidth(), onClick = if (s.resuming) null else viewModel::resume) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text("Volver a «${r.name}»", style = MaterialTheme.typography.titleSmall)
                            Text("Entraste hace poco · ${r.people} ${if (r.people == 1) "persona" else "personas"}", style = MaterialTheme.typography.bodySmall, color = Ms.Muted)
                        }
                        MsButton(if (s.resuming) "Entrando…" else "Volver", viewModel::resume, small = true, enabled = !s.resuming, icon = Ic.Refresh)
                    }
                }
            }
            s.resumeError?.let { Spacer(Modifier.height(12.dp)); com.mirrorstudio.app.presentation.ui.Callout(it) }
            Spacer(Modifier.height(32.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Reuniones en tu red", style = MaterialTheme.typography.titleMedium)
                    Text(
                        when {
                            s.searching -> "Buscando…"
                            s.nearby.isEmpty() -> "No se encontró ninguna"
                            s.nearby.size == 1 -> "1 reunión encontrada"
                            else -> "${s.nearby.size} reuniones encontradas"
                        },
                        style = MaterialTheme.typography.bodySmall, color = Ms.Muted
                    )
                }
                Spinning(s.searching) { mod -> RoundButton(Ic.Refresh, "Buscar ahora", viewModel::refresh, mod, fg = Ms.Accent, enabled = !s.searching) }
            }
            Spacer(Modifier.height(12.dp))
            s.nearby.forEachIndexed { i, m -> NearbyCard(m, i) { onJoinIp(m.ip, m.port) } }
            if (s.searchedOnce && !s.searching && s.nearby.isEmpty()) {
                Text(
                    "Solo se buscan PCs de tu misma red. Si la clase está en otra red del campus, usa el QR o pide la IP y el código.",
                    style = MaterialTheme.typography.bodySmall, color = Ms.Muted
                )
            }
            Spacer(Modifier.height(24.dp))
        }
    }

    if (help) {
        AlertDialog(
            onDismissRequest = { help = false },
            title = { Text("Para que funcione") },
            text = {
                Text(
                    "• El teléfono y la PC del docente deben estar en la misma red de la universidad (Wi-Fi o cable).\n" +
                        "• La PC del docente debe permitir MirrorStudio en el firewall (puerto 47800).\n" +
                        "• Si el Wi-Fi aísla a los dispositivos, pide a TI que lo permita en las aulas."
                )
            },
            confirmButton = { TextButton(onClick = { help = false }) { Text("Entendido") } },
            containerColor = Ms.Surface
        )
    }
}

@Composable
private fun Spinning(active: Boolean, content: @Composable (Modifier) -> Unit) {
    val t = rememberInfiniteTransition(label = "giro")
    val deg by t.animateFloat(0f, 360f, infiniteRepeatable(tween(900, easing = LinearEasing), RepeatMode.Restart), label = "grados")
    content(if (active) Modifier.rotate(deg) else Modifier)
}

/** Tarjeta de una reunion encontrada; entran escalonadas (40 ms entre una y otra). */
@Composable
private fun NearbyCard(m: NearbyMeeting, index: Int, onJoin: () -> Unit) {
    val visible = remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { kotlinx.coroutines.delay(40L * index); visible.value = true }
    AnimatedVisibility(
        visible.value,
        enter = fadeIn(tween(Motion.SCREEN)) + slideInVertically(tween(Motion.SCREEN, easing = Motion.Ease)) { it / 4 }
    ) {
        Card(Modifier.fillMaxWidth().padding(bottom = 10.dp), onClick = if (m.compatible) onJoin else null) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(40.dp).background(Ms.AccentSoft, RoundedCornerShape(12.dp)), contentAlignment = Alignment.Center) {
                    androidx.compose.material3.Icon(Ic.Monitor, null, tint = Ms.Accent, modifier = Modifier.size(20.dp))
                }
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(m.name, style = MaterialTheme.typography.titleSmall)
                    Text(
                        if (m.compatible) "${m.hostName} · ${m.ip} · ${m.participants} ${if (m.participants == 1) "persona" else "personas"}"
                        else "${m.hostName} · versión distinta de MirrorStudio",
                        style = MaterialTheme.typography.bodySmall, color = if (m.compatible) Ms.Muted else Ms.Warn
                    )
                }
                if (m.compatible) MsButton("Unirse", onJoin, small = true)
            }
        }
    }
}
