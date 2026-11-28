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
import androidx.compose.ui.geometry.Rect
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
 * Entrada «Doble Erre», el mismo guion que el escritorio (mirrorstudio-intro.js, `frameAt`): la primera erre
 * sube y aparece, la segunda llega desde la izquierda y arriba como un eco, aparece el nombre y, a los 640 ms,
 * la marca se encoge hasta el logo del encabezado mientras el fondo oscuro se desvanece y la tinta pasa de
 * blanco a la del tema. Con menos movimiento solo hay un fundido.
 */
@Composable
fun BrandIntro(anchor: BrandAnchor, onDone: () -> Unit) {
    val reduced = reducedMotion()
    var time by remember { mutableFloatStateOf(0f) }
    LaunchedEffect(Unit) {
        val start = withFrameMillis { it }
        while (true) {
            val now = withFrameMillis { it }
            time = (now - start).toFloat()
            val a = if (reduced) phase(time, 400f, 520f) else phase(time, 640f, 1060f)
            if (a >= 1f) break
        }
        anchor.playing = false
        onDone()
    }

    Canvas(Modifier.fillMaxSize()) {
        val w = size.width
        val h = size.height
        val heroW = max(66f * density, min(144f * density, min(w * .22f, h * .235f)))
        val wordW = heroW * 1.37f
        val gap = 20f * density
        val heroH = heroW * BrandForms.MARK_H / BrandForms.MARK_W
        val heroX = w / 2 - heroW / 2
        val heroY = h / 2 - (heroH + gap + wordW * BrandForms.WORD_H / BrandForms.WORD_W) / 2

        val a = if (reduced) phase(time, 400f, 520f) else phase(time, 640f, 1060f)
        val u = smooth(a)
        val a1 = if (reduced) 1f else easeOut(phase(time, 0f, 265f))
        val a2 = if (reduced) 1f else easeOut(phase(time, 105f, 395f))

        val target = anchor.bounds?.takeIf { it.width > 2 && it.height > 2 }?.let { r ->
            val tw = min(r.width, r.height * BrandForms.MARK_W / BrandForms.MARK_H)
            val th = tw * BrandForms.MARK_H / BrandForms.MARK_W
            Rect(r.left + (r.width - tw) / 2, r.top + (r.height - th) / 2, r.left + (r.width + tw) / 2, r.top + (r.height + th) / 2)
        }
        val x = mix(heroX, target?.left ?: heroX, u)
        val y = mix(heroY, target?.top ?: heroY, u)
        val mw = mix(heroW, target?.width ?: heroW, u)
        val scrim = if (reduced) 1f - a else 1f - smooth(phase(a, .10f, .94f))
        val markAlpha = if (target != null) 1f else 1f - smooth(phase(a, .06f, .85f))
        val ink = lerp(Color.White, Ms.Fg, smooth(phase(a, .24f, .90f)))
        val wordAlpha = (if (reduced) 1f else smooth(phase(time, 290f, 530f))) * (1f - smooth(phase(a, 0f, .36f)))
        val px = density

        drawRect(Ms.Stage, alpha = scrim)
        drawMark(
            x, y, mw, ink,
            a1 = a1, a2 = a2,
            dy1 = 8f * px * (1 - a1), dx2 = 10f * px * (1 - a2), dy2 = 5f * px * (1 - a2),
            alpha = if (reduced) scrim.coerceAtLeast(if (target != null) 1f else 0f) else markAlpha
        )
        drawWord((w - wordW) / 2, heroY + heroH + gap, wordW, Color.White, wordAlpha)
    }
}
