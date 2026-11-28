package com.mirrorstudio.app.presentation.brand

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathFillType
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.mirrorstudio.app.presentation.motion.reducedMotion
import com.mirrorstudio.app.presentation.theme.Ms

internal object BrandPaths {
    val r1: Path by lazy { PathParser().parsePathString(BrandForms.R1).toPath() }
    val r2: Path by lazy { PathParser().parsePathString(BrandForms.R2).toPath() }
    val word: Path by lazy { PathParser().parsePathString(BrandForms.WORD).toPath().apply { fillType = PathFillType.EvenOdd } }
}

/**
 * Dibuja la doble R en una caja que empieza en (x, y) y mide [w] px de ancho. [dy1], [dx2] y [dy2] son
 * desplazamientos en px de la entrada; [a1] y [a2] la opacidad de cada erre.
 */
internal fun DrawScope.drawMark(
    x: Float, y: Float, w: Float, ink: Color,
    a1: Float = 1f, a2: Float = 1f, dy1: Float = 0f, dx2: Float = 0f, dy2: Float = 0f, alpha: Float = 1f
) {
    val k = w / BrandForms.MARK_W
    translate(x, y + dy1) { scale(k, k, Offset.Zero) { drawPath(BrandPaths.r1, ink, alpha = a1 * alpha) } }
    translate(x + dx2, y + dy2) { scale(k, k, Offset.Zero) { drawPath(BrandPaths.r2, ink, alpha = a2 * alpha) } }
}

internal fun DrawScope.drawWord(x: Float, y: Float, w: Float, ink: Color, alpha: Float) {
    val k = w / BrandForms.WORD_W
    translate(x, y) { scale(k, k, Offset.Zero) { drawPath(BrandPaths.word, ink, alpha = alpha) } }
}

/** Isotipo «Doble Erre» de [width] de ancho. */
@Composable
fun BrandMark(width: Dp, modifier: Modifier = Modifier, ink: Color = Ms.Fg) {
    Canvas(modifier.size(width, width * (BrandForms.MARK_H / BrandForms.MARK_W))) { drawMark(0f, 0f, size.width, ink) }
}

/** El nombre «MirrorStudio» con las letras trazadas del kit (no depende de una fuente). */
@Composable
fun Wordmark(height: Dp, modifier: Modifier = Modifier, ink: Color = Ms.Fg) {
    Canvas(
        modifier
            .size(height * (BrandForms.WORD_W / BrandForms.WORD_H), height)
            .semantics { contentDescription = "MirrorStudio" }
    ) { drawWord(0f, 0f, size.width, ink, 1f) }
}

/**
 * La «nube» del escritorio (`.hero-glow`): un resplandor del color de acento detras de la marca que respira
 * cada 4 s, sobre una reticula de puntos tenue (`.home-bg`).
 */
@Composable
fun BrandGlow(modifier: Modifier = Modifier, diameter: Dp = 260.dp) {
    val still = reducedMotion()
    val t = rememberInfiniteTransition(label = "nube")
    val phase by t.animateFloat(0f, 1f, infiniteRepeatable(tween(4000, easing = LinearEasing), RepeatMode.Restart), label = "fase")
    Canvas(modifier) {
        val step = 22.dp.toPx()
        val dot = Ms.Fg.copy(alpha = 0.07f)
        var yy = step / 2
        while (yy < size.height) {
            var xx = step / 2
            while (xx < size.width) { drawCircle(dot, 1.dp.toPx(), Offset(xx, yy)); xx += step }
            yy += step
        }
        val wave = if (still) 0f else ((1 - kotlin.math.cos(phase * 2 * Math.PI)) / 2).toFloat()
        val r = diameter.toPx() / 2 * (1f + 0.1f * wave)
        val c = Offset(size.width / 2, size.height / 2)
        drawCircle(
            Brush.radialGradient(listOf(Ms.Accent.copy(alpha = 0.35f * (0.5f + 0.3f * wave) / 0.8f), Color.Transparent), c, r),
            r, c
        )
        // Toque morado como en la entrada del escritorio.
        drawCircle(
            Brush.radialGradient(listOf(Color(0xFF7C3AED).copy(alpha = 0.16f * (0.6f + 0.4f * wave)), Color.Transparent), c + Offset(r * 0.35f, -r * 0.2f), r * 0.8f),
            r * 0.8f, c + Offset(r * 0.35f, -r * 0.2f)
        )
    }
}
