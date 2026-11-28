package com.mirrorstudio.app.presentation.motion

import android.provider.Settings
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback

/**
 * Movimiento del prototipo: breve, silencioso y sin rebotes. Curva por defecto: desaceleracion cubica suave
 * (`cubic-bezier(.22,1,.36,1)` en ms.css). Con «Quitar animaciones» del sistema todo pasa a fundidos de 120 ms.
 */
object Motion {
    val Ease = CubicBezierEasing(0.22f, 1f, 0.36f, 1f)
    const val SCREEN = 250
    const val REDUCED = 120
    const val PRESS = 0.96f
}

/** true si la persona pidio menos movimiento (escala de animacion 0 en Accesibilidad u Opciones de desarrollador). */
@Composable
fun reducedMotion(): Boolean {
    val context = LocalContext.current
    return remember {
        runCatching { Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) }.getOrDefault(1f) == 0f
    }
}

/** El control se hunde al 96 % mientras se pulsa. Pasar el mismo [interaction] que usa el boton. */
fun Modifier.pressScale(interaction: MutableInteractionSource, scale: Float = Motion.PRESS): Modifier = composed {
    val pressed by interaction.collectIsPressedAsState()
    val s by animateFloatAsState(if (pressed) scale else 1f, tween(if (pressed) 90 else 160, easing = Motion.Ease), label = "press")
    graphicsLayer { scaleX = s; scaleY = s }
}

/** Vibracion corta para acciones clave (QR leido, mano, voto). */
@Composable
fun rememberTick(): () -> Unit {
    val h = LocalHapticFeedback.current
    return remember(h) { { h.performHapticFeedback(HapticFeedbackType.LongPress) } }
}
