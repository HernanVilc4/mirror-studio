package com.mirrorstudio.app.presentation.ended

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.mirrorstudio.app.domain.EndKind
import com.mirrorstudio.app.presentation.motion.Motion
import com.mirrorstudio.app.presentation.theme.DisplayStyle
import com.mirrorstudio.app.presentation.theme.Ms
import com.mirrorstudio.app.presentation.ui.BtnKind
import com.mirrorstudio.app.presentation.ui.Ic
import com.mirrorstudio.app.presentation.ui.MsButton

/** Pantallas 34 (terminó), 35 (expulsado) y el final de 14 (no se pudo reconectar). */
@Composable
fun EndedScreen(kind: EndKind, reason: String, canRetry: Boolean, onHome: () -> Unit, onRetry: () -> Unit) {
    val (title, body, icon, tint) = when (kind) {
        EndKind.KICKED -> Quad("Te sacaron de la reunión", "Un docente te expulsó. Si crees que fue un error, pídele el enlace otra vez.", Ic.Close, Ms.Danger)
        EndKind.CONNECTION_LOST -> Quad("Se perdió la conexión", "No se pudo volver a conectar con la PC anfitriona. Revisa que sigues en la red de la universidad.", Ic.WifiOff, Ms.Warn)
        EndKind.LEFT -> Quad("Saliste de la reunión", "Puedes volver a entrar con el mismo código mientras siga abierta.", Ic.Leave, Ms.Muted)
        EndKind.FINISHED -> Quad("La reunión terminó", reason.takeIf { it.isNotBlank() && it != "Conexión cerrada" }?.let { "$it. Gracias por conectarte." } ?: "El anfitrión cerró la sala. Gracias por conectarte.", Ic.Check, Ms.Ok)
    }
    val enter = remember { Animatable(0f) }
    LaunchedEffect(Unit) { enter.animateTo(1f, tween(400, easing = Motion.Ease)) }
    Box(Modifier.fillMaxSize().background(Ms.Bg).safeDrawingPadding().padding(24.dp)) {
        Column(
            Modifier.align(Alignment.Center).graphicsLayer { alpha = enter.value; translationY = (1 - enter.value) * 24.dp.toPx() },
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Box(Modifier.size(72.dp).background(tint.copy(alpha = 0.12f), CircleShape), contentAlignment = Alignment.Center) {
                Icon(icon, null, tint = tint, modifier = Modifier.size(32.dp))
            }
            Spacer(Modifier.height(8.dp))
            Text(title, style = DisplayStyle, textAlign = TextAlign.Center)
            Text(body, style = MaterialTheme.typography.bodyLarge, color = Ms.Muted, textAlign = TextAlign.Center)
        }
        Column(Modifier.align(Alignment.BottomCenter).fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            if (canRetry) MsButton("Intentar de nuevo", onRetry, Modifier.fillMaxWidth(), icon = Ic.Refresh, large = true)
            MsButton("Volver al inicio", onHome, Modifier.fillMaxWidth(), kind = if (canRetry) BtnKind.Secondary else BtnKind.Primary, large = !canRetry)
        }
    }
}

private data class Quad<A, B, C, D>(val a: A, val b: B, val c: C, val d: D)
