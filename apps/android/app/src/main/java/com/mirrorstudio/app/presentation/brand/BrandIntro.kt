package com.mirrorstudio.app.presentation.brand

import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.material3.Text
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Paint
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.mirrorstudio.app.presentation.motion.Motion
import com.mirrorstudio.app.presentation.motion.reducedMotion
import com.mirrorstudio.app.presentation.theme.Montserrat
import com.mirrorstudio.app.presentation.theme.Ms
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min

/**
 * Donde termina la marca de la entrada: el logo del encabezado de Inicio. Mientras la entrada esta en curso, el
 * logo real se oculta y la marca animada vuela hasta su sitio.
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
private fun mix(a: Float, b: Float, t: Float) = a + (b - a) * t
private fun smooth(x: Float) = x * x * (3 - 2 * x)

// Las curvas del CSS del prototipo.
private val PROTO_EASE = Motion.Ease                                  // --ease: cubic-bezier(.22,1,.36,1)
private val CSS_EASE = CubicBezierEasing(0.25f, 0.1f, 0.25f, 1f)      // ease
private val CSS_EASE_OUT = CubicBezierEasing(0f, 0f, 0.58f, 1f)       // ease-out
private val CSS_EASE_IN_OUT = CubicBezierEasing(0.42f, 0f, 0.58f, 1f) // ease-in-out
private fun protoEase(x: Float) = PROTO_EASE.transform(clamp(x))
private fun cssEase(x: Float) = CSS_EASE.transform(clamp(x))
private fun cssEaseOut(x: Float) = CSS_EASE_OUT.transform(clamp(x))
private fun cssEaseInOut(x: Float) = CSS_EASE_IN_OUT.transform(clamp(x))
/** 0 -> 1 -> 0 en un ciclo, como un `alternate` infinito. */
private fun wave(cycle: Float) = (1f - cos(2.0 * PI * cycle).toFloat()) / 2f

private val Ink = Color(0xFF0B1020)
private val Violet = Color(0xFF8B5CF6)
private val BOTH: Path by lazy { Path().apply { addPath(BrandPaths.r1); addPath(BrandPaths.r2) } }

/** Si nadie toca, la entrada continua sola poco despues de que aparezca la leyenda (1,9 s). */
private const val AUTO_ENTER_MS = 4300f

/**
 * Entrada de MirrorStudio, tal cual la pantalla «Entrada de MirrorStudio» del prototipo (Main.dc.html y ms.css):
 * fondo blanco con reticula de puntos; una nube de acento y otra violeta que crecen y siguen respirando; dos
 * anillos de eco; la primera erre sube y la segunda llega un instante despues; un destello cruza la marca; debajo,
 * su reflejo; aparece el nombre y al final «Toca para entrar». Al tocar (o pasados unos segundos) la marca queda
 * quieta y vuela hasta el logo del encabezado de Inicio mientras el resto se desvanece.
 *
 * Tiempos en ms, los del CSS: erre 1 = 265; erre 2 = 290 tras 105; nombre = 240 tras 290; anillos = 1800 tras 550
 * y 850; destello = 900 tras 950; reflejo = 900 tras 1000; nube azul = 1200; nube violeta = 1400 tras 300;
 * leyenda = 300 tras 1600.
 */
@Composable
fun BrandIntro(anchor: BrandAnchor, onDone: () -> Unit) {
    val reduced = reducedMotion()
    var time by remember { mutableFloatStateOf(0f) }
    var exitAt by remember { mutableFloatStateOf(-1f) }
    val exitMs = if (reduced) 120f else 480f
    // Con «Quitar animaciones» todo aparece ya puesto (el prototipo lo reduce a 120 ms).
    val t0 = if (reduced) 2500f else 0f
    LaunchedEffect(Unit) {
        val start = withFrameMillis { it }
        while (true) {
            val now = withFrameMillis { it }
            time = (now - start).toFloat() + t0
            if (exitAt < 0f && time > AUTO_ENTER_MS) exitAt = time
            if (exitAt >= 0f && time >= exitAt + exitMs) break
        }
        anchor.playing = false
        onDone()
    }

    val density = LocalDensity.current.density
    val screenH = LocalConfiguration.current.screenHeightDp.toFloat()
    // El bloque de la marca mide 268 dp y la leyenda va debajo: el conjunto queda centrado en la pantalla.
    val top = (screenH - 292f) / 2f
    val e = if (exitAt < 0f) 0f else phase(time, exitAt, exitAt + exitMs)   // 0 = en la entrada, 1 = ya en el encabezado
    val rest = 1f - smooth(phase(e, 0f, 0.7f))                              // todo lo demas se desvanece

    Box(
        Modifier
            .fillMaxSize()
            .background(Color.White)
            .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) { if (exitAt < 0f) exitAt = time }
    ) {
        Canvas(Modifier.fillMaxSize()) {
            val px = density
            val w = size.width
            val cx = w / 2f
            val boxTop = top * px
            val t = time

            // Reticula: radial-gradient(rgba(11,16,32,.07) 1px, transparent 1px), cada 22 px.
            val dot = Ink.copy(alpha = 0.07f * rest)
            val step = 22f * px
            var yy = step / 2
            while (yy < size.height) {
                var xx = step / 2
                while (xx < w) { drawCircle(dot, 1f * px, Offset(xx, yy)); xx += step }
                yy += step
            }

            // Nube de acento: 330 dp, entra en 1,2 s (de .55 a 1 de escala) y luego respira cada 4 s.
            val ca = protoEase(phase(t, 0f, 1200f))
            val glowing = t > 1200f
            val gw = cssEaseInOut(wave(((t - 1200f) / 4000f) % 1f))
            val aAlpha = if (glowing) 0.78f + 0.22f * gw else ca
            val aScale = if (glowing) 1f + 0.10f * gw else 0.55f + 0.45f * ca
            val aCenter = Offset(cx, boxTop + 107f * px)
            val aR = 165f * px * aScale
            drawCircle(Brush.radialGradient(listOf(Ms.Accent.copy(alpha = 0.38f), Color.Transparent), aCenter, aR), aR, aCenter, alpha = aAlpha * rest)

            // Nube violeta: 240 dp, entra en 1,4 s tras 0,3 s y despues deriva (28, -18) dp cada 7 s.
            val cb = protoEase(phase(t, 300f, 1700f))
            val dw = if (t > 1700f) cssEaseInOut(wave(((t - 1700f) / 7000f) % 1f)) else 0f
            val bCenter = Offset(cx + 80f * px + 28f * px * dw, boxTop + 167f * px - 18f * px * dw)
            val bR = 120f * px * (0.55f + 0.45f * cb)
            drawCircle(Brush.radialGradient(listOf(Violet.copy(alpha = 0.28f), Color.Transparent), bCenter, bR), bR, bCenter, alpha = cb * rest)

            // Anillos de eco: 150 dp, de .5 a 2,7 de escala mientras se desvanecen (1,8 s, tras .55 s y .85 s).
            // Como en el CSS (`both`), antes de su turno ya muestran su primer cuadro (escala .5, opacidad .6).
            for (delay in floatArrayOf(550f, 850f)) {
                val u = cssEaseOut(phase(t, delay, delay + 1800f))
                drawCircle(Ms.Accent.copy(alpha = 0.6f * (1f - u) * rest), 75f * px * (0.5f + 2.2f * u), Offset(cx, boxTop + 142f * px), style = Stroke(2f * px))
            }

            // La marca: 144 dp de ancho, a 60 dp del borde del bloque.
            val markW = 144f * px
            val markH = markW * BrandForms.MARK_H / BrandForms.MARK_W
            val heroX = cx - markW / 2f
            val heroY = boxTop + 60f * px

            // Reflejo: la marca vuelta, a 6 dp debajo; opacidad hasta .2 y se pierde hacia abajo (mascara al 72 %).
            val reflectA = 0.2f * cssEase(phase(t, 1000f, 1900f)) * rest
            if (reflectA > 0f) {
                val ry = heroY + markH + 6f * px
                drawContext.canvas.saveLayer(Rect(heroX, ry, heroX + markW, ry + markH), Paint().apply { alpha = reflectA })
                scale(1f, -1f, Offset(cx, ry + markH / 2f)) { drawMark(heroX, ry, markW, Ink) }
                drawRect(
                    Brush.verticalGradient(0f to Color.Black, 0.72f to Color.Transparent, 1f to Color.Transparent, startY = ry, endY = ry + markH),
                    topLeft = Offset(heroX, ry), size = Size(markW, markH), blendMode = BlendMode.DstIn
                )
                drawContext.canvas.restore()
            }

            // Erres: la 1 sube 21 u en 265 ms; la 2 llega desde (26, 13) u en 290 ms tras 105 ms.
            val p1 = protoEase(phase(t, 0f, 265f))
            val p2 = protoEase(phase(t, 105f, 395f))
            val target = anchor.bounds?.takeIf { it.width > 2 && it.height > 2 }?.let { r ->
                val tw = min(r.width, r.height * BrandForms.MARK_W / BrandForms.MARK_H)
                val th = tw * BrandForms.MARK_H / BrandForms.MARK_W
                Rect(r.left + (r.width - tw) / 2, r.top + (r.height - th) / 2, r.left + (r.width + tw) / 2, r.top + (r.height + th) / 2)
            }
            val u = smooth(e)
            val mx = mix(heroX, target?.left ?: heroX, u)
            val my = mix(heroY, target?.top ?: heroY, u)
            val mw = mix(markW, target?.width ?: markW, u)
            val kk = mw / BrandForms.MARK_W
            drawMark(
                mx, my, mw, Ink, a1 = p1, a2 = p2,
                dy1 = 21f * kk * (1f - p1), dx2 = 26f * kk * (1f - p2), dy2 = 13f * kk * (1f - p2),
                alpha = if (target != null) 1f else rest
            )

            // Destello: una banda blanca de 110 u cruza la marca (900 ms tras 950 ms), recortada a su forma.
            val sw = cssEaseInOut(phase(t, 950f, 1850f))
            if (sw > 0f && sw < 1f) {
                val sx = -140f + 640f * sw
                translate(mx, my) {
                    scale(kk, kk, Offset.Zero) {
                        clipPath(BOTH) {
                            drawRect(
                                Brush.horizontalGradient(
                                    0f to Color.White.copy(alpha = 0f), 0.5f to Color.White.copy(alpha = 0.95f), 1f to Color.White.copy(alpha = 0f),
                                    startX = sx, endX = sx + 110f
                                ),
                                topLeft = Offset(sx, -10f), size = Size(110f, 290f), alpha = rest
                            )
                        }
                    }
                }
            }
        }

        // «MirrorStudio»: Montserrat 800, 28/34, a 214 dp del borde del bloque (se mete 62 dp sobre el reflejo).
        Text(
            "MirrorStudio",
            Modifier.align(Alignment.TopCenter).offset(y = (top + 214f).dp).alpha(cssEase(phase(time, 290f, 530f)) * rest),
            style = TextStyle(fontFamily = Montserrat, fontWeight = FontWeight.ExtraBold, fontSize = 28.sp, lineHeight = 34.sp, letterSpacing = (-0.28).sp, color = Ink, textAlign = TextAlign.Center)
        )
        Text(
            "Toca para entrar",
            Modifier.align(Alignment.TopCenter).offset(y = (top + 276f).dp).alpha(cssEase(phase(time, 1600f, 1900f)) * rest),
            style = TextStyle(fontSize = 12.sp, lineHeight = 16.sp, color = Ms.Muted, textAlign = TextAlign.Center)
        )
    }
}
