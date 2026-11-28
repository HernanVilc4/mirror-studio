package com.mirrorstudio.app.presentation.classroom

import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.mirrorstudio.app.domain.Member
import com.mirrorstudio.app.presentation.motion.rememberTick
import com.mirrorstudio.app.presentation.theme.DisplayStyle
import com.mirrorstudio.app.presentation.theme.Ms
import com.mirrorstudio.app.presentation.ui.BtnKind
import com.mirrorstudio.app.presentation.ui.Ic
import com.mirrorstudio.app.presentation.ui.MsButton
import com.mirrorstudio.app.presentation.ui.ScreenHeader

/** Pantalla 15: como vincular el telefono con mi PC. */
@Composable
fun PairIntroScreen(onBack: () -> Unit, onScan: () -> Unit) {
    BackHandler(onBack = onBack)
    Column(Modifier.fillMaxSize().background(Ms.Bg).statusBarsPadding().navigationBarsPadding()) {
        ScreenHeader("Control de tu propia PC", onBack)
        Column(Modifier.weight(1f).padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Text("Vincula tu teléfono", style = DisplayStyle)
            Text(
                "Con tu teléfono vinculado pasas las diapositivas, usas el puntero láser y anotas sobre lo que presentas, sin pedir permiso cada vez.",
                style = MaterialTheme.typography.bodyLarge, color = Ms.Muted
            )
            Step(1, "En tu PC, en la sala, pulsa «Más» → «Vincular mi teléfono».")
            Step(2, "Escanea el QR que aparece. Solo lo ves tú: no sale en la presentación.")
            Step(3, "Listo: el vínculo dura toda la reunión.")
        }
        MsButton("Escanear QR de vinculación", onScan, Modifier.fillMaxWidth().padding(20.dp), icon = Ic.Qr, large = true)
    }
}

@Composable
private fun Step(n: Int, text: String) {
    Row(verticalAlignment = Alignment.Top) {
        Box(Modifier.size(28.dp).background(Ms.AccentSoft, CircleShape), contentAlignment = Alignment.Center) {
            Text("$n", style = MaterialTheme.typography.labelMedium, color = Ms.Accent)
        }
        Spacer(Modifier.width(12.dp))
        Text(text, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.padding(top = 3.dp))
    }
}

/**
 * Pantalla 16: entre los iconos de PC y telefono viajan puntos que se juntan en un visto, con un anillo que se
 * expande (700 ms).
 */
@Composable
fun PairedScreen(pc: Member, onOpenSlides: () -> Unit, onClose: () -> Unit) {
    BackHandler(onBack = onClose)
    val travel = remember { Animatable(0f) }
    val ring = remember { Animatable(0f) }
    val tick = rememberTick()
    LaunchedEffect(Unit) {
        travel.animateTo(1f, tween(450))
        tick()
        ring.animateTo(1f, tween(250))
    }
    Column(
        Modifier.fillMaxSize().background(Ms.Bg).statusBarsPadding().navigationBarsPadding().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Spacer(Modifier.weight(1f))
        Box(Modifier.fillMaxWidth().height(120.dp), contentAlignment = Alignment.Center) {
            Canvas(Modifier.fillMaxSize()) {
                val y = size.height / 2
                val left = size.width * 0.2f; val right = size.width * 0.8f; val mid = size.width / 2
                for (i in 0 until 3) {
                    val t = (travel.value - i * 0.15f).coerceIn(0f, 1f)
                    drawCircle(Ms.Accent, 4.dp.toPx(), Offset(left + (mid - left) * t, y), alpha = 1f - ring.value)
                    drawCircle(Ms.Accent, 4.dp.toPx(), Offset(right - (right - mid) * t, y), alpha = 1f - ring.value)
                }
                if (ring.value > 0f) drawCircle(Ms.Ok, 28.dp.toPx() + 22.dp.toPx() * ring.value, Offset(mid, y), alpha = 1f - ring.value, style = Stroke(3.dp.toPx()))
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Icon(Ic.Monitor, null, tint = Ms.Fg, modifier = Modifier.size(44.dp))
                if (travel.value >= 1f) Box(Modifier.size(56.dp).background(Ms.Ok, CircleShape), contentAlignment = Alignment.Center) {
                    Icon(Ic.Check, null, tint = Ms.Surface, modifier = Modifier.size(30.dp))
                }
                Icon(Ic.Phone, null, tint = Ms.Fg, modifier = Modifier.size(44.dp))
            }
        }
        Spacer(Modifier.height(28.dp))
        Text("Vinculado con ${pc.name}", style = DisplayStyle, textAlign = TextAlign.Center)
        Spacer(Modifier.height(8.dp))
        Text(
            "Ahora controlas tu presentación desde aquí. Si tu PC presenta, el teléfono la muestra en vivo.",
            style = MaterialTheme.typography.bodyLarge, color = Ms.Muted, textAlign = TextAlign.Center
        )
        Spacer(Modifier.weight(1f))
        MsButton("Abrir control de diapositivas", onOpenSlides, Modifier.fillMaxWidth(), icon = Ic.Play, large = true)
        Spacer(Modifier.height(8.dp))
        MsButton("Volver a la sala", onClose, Modifier.fillMaxWidth(), kind = BtnKind.Ghost)
    }
}
