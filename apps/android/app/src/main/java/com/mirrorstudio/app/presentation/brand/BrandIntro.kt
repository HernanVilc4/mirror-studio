package com.mirrorstudio.app.presentation.brand

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.runtime.withFrameMillis
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.draw.alpha
import com.mirrorstudio.app.presentation.motion.reducedMotion
import com.mirrorstudio.app.presentation.theme.Ms
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow

/**
 * Donde termina la marca de la entrada: el logo del encabezado de Inicio. Mientras la entrada esta en curso, el
 * logo real se oculta ([hideAnchor]) y la marca animada vuela hasta su sitio.
 */
@Stable
class BrandAnchor {
    var bounds by mutableStateOf<Rect?>(null)
    var playing by mutableStateOf(true)
}

val LocalBrandAnchor = staticCompositionLocalOf { BrandAnchor().apply { playing = false } }

/** Marca el composable como destino de la entrada y lo oculta mientras la marca vuela hacia el. */
fun Modifier.brandAnchor(anchor: BrandAnchor): Modifier =
    this.onGloballyPositioned { anchor.bounds = it.boundsInRoot() }.alpha(if (anchor.playing) 0f else 1f)

private fun clamp(x: Float) = min(1f, max(0f, x))
private fun phase(t: Float, a: Float, b: Float) = clamp((t - a) / (b - a))
private fun smooth(x: Float) = x * x * (3 - 2 * x)
private fun easeOut(x: Float) = 1 - (1 - x).pow(3)
private fun mix(a: Float, b: Float, t: Float) = a + (b - a) * t

/**
 * Entrada «Doble Erre» (prototipo, «Movimiento»): sobre el fondo oscuro de la marca crece la nube morada, la primera
 * erre sube y aparece, la segunda llega como un eco desde la izquierda y arriba, aparece el nombre y la marca queda
 * quieta un instante. Luego se encoge y vuela hasta el logo del encabezado de Inicio mientras el fondo se desvanece
 * y la tinta pasa de blanco a la del tema. Con menos movimiento solo hay un fundido.
 */
private const val HOLD_UNTIL = 1650f   // la marca queda quieta hasta aqui
private const val FLIGHT = 520f        // y luego vuela al encabezado

@Composable
fun BrandIntro(anchor: BrandAnchor, onDone: () -> Unit) {
    com.mirrorstudio.app.presentation.ui.DarkSystemBars()   // hora y baterias claras sobre el fondo oscuro
    val reduced = reducedMotion()
    var time by remember { mutableFloatStateOf(0f) }
    val flightStart = if (reduced) 300f else HOLD_UNTIL
    val flightEnd = if (reduced) 420f else HOLD_UNTIL + FLIGHT
    LaunchedEffect(Unit) {
        val start = withFrameMillis { it }
        while (true) {
            val now = withFrameMillis { it }
            time = (now - start).toFloat()
            if (time >= flightEnd) break
        }
        anchor.playing = false
        onDone()
    }

    Canvas(Modifier.fillMaxSize()) {
        val px = density
        val w = size.width
        val h = size.height
        val heroW = max(80f * px, min(168f * px, min(w * .26f, h * .26f)))
        val wordW = heroW * 1.37f
        val gap = 22f * px
        val heroH = heroW * BrandForms.MARK_H / BrandForms.MARK_W
        val wordH = wordW * BrandForms.WORD_H / BrandForms.WORD_W
        val heroX = w / 2 - heroW / 2
        val heroY = h / 2 - (heroH + gap + wordH) / 2

        val a = phase(time, flightStart, flightEnd)       // 0 = quieta, 1 = ya en el encabezado
        val u = smooth(a)
        val a1 = if (reduced) 1f else easeOut(phase(time, 150f, 600f))
        val a2 = if (reduced) 1f else easeOut(phase(time, 330f, 850f))
        val wordIn = if (reduced) 1f else smooth(phase(time, 800f, 1250f))
        val cloudIn = if (reduced) 1f else smooth(phase(time, 0f, 1100f))

        val target = anchor.bounds?.takeIf { it.width > 2 && it.height > 2 }?.let { r ->
            val tw = min(r.width, r.height * BrandForms.MARK_W / BrandForms.MARK_H)
            val th = tw * BrandForms.MARK_H / BrandForms.MARK_W
            Rect(r.left + (r.width - tw) / 2, r.top + (r.height - th) / 2, r.left + (r.width + tw) / 2, r.top + (r.height + th) / 2)
        }
        val x = mix(heroX, target?.left ?: heroX, u)
        val y = mix(heroY, target?.top ?: heroY, u)
        val mw = mix(heroW, target?.width ?: heroW, u)
        val scrim = 1f - smooth(phase(a, .10f, .94f))
        val markAlpha = if (target != null) 1f else 1f - smooth(phase(a, .06f, .85f))
        val ink = lerp(Color.White, Ms.Fg, smooth(phase(a, .24f, .90f)))
        val wordAlpha = wordIn * (1f - smooth(phase(a, 0f, .36f)))

        drawRect(Ms.Stage, alpha = scrim)

        // La nube morada: dos resplandores (acento y violeta) que crecen y respiran detras de la marca.
        val breath = if (reduced) 0f else (0.5f + 0.5f * kotlin.math.sin(time / 420f))
        val cloudAlpha = cloudIn * scrim * (1f - smooth(phase(a, 0f, .5f)))
        if (cloudAlpha > 0f) {
            val c = Offset(w / 2, heroY + heroH / 2)
            val r = heroW * (1.6f + 0.9f * cloudIn + 0.12f * breath)
            drawCircle(Brush.radialGradient(listOf(Ms.Accent.copy(alpha = 0.55f * cloudAlpha), Color.Transparent), c, r), r, c)
            val c2 = c + Offset(r * 0.14f, -r * 0.09f)
            val r2 = r * 0.78f
            drawCircle(Brush.radialGradient(listOf(Color(0xFF7C3AED).copy(alpha = 0.50f * cloudAlpha), Color.Transparent), c2, r2), r2, c2)
            val c3 = c + Offset(-r * 0.15f, r * 0.11f)
            val r3 = r * 0.62f
            drawCircle(Brush.radialGradient(listOf(Color(0xFF9B7BFF).copy(alpha = 0.30f * cloudAlpha), Color.Transparent), c3, r3), r3, c3)
        }

        drawMark(
            x, y, mw, ink,
            a1 = a1, a2 = a2,
            // La primera sube; la segunda llega como eco, desde la izquierda y arriba.
            dy1 = 18f * px * (1 - a1), dx2 = -26f * px * (1 - a2), dy2 = -16f * px * (1 - a2),
            alpha = if (reduced) scrim.coerceAtLeast(if (target != null) 1f else 0f) else markAlpha
        )
        drawWord((w - wordW) / 2, heroY + heroH + gap + 10f * px * (1 - wordIn), wordW, Color.White, wordAlpha)
    }
}
