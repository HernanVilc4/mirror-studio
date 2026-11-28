package com.mirrorstudio.app.presentation.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.ExperimentalTextApi
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import com.mirrorstudio.app.R

/** Mismos colores que el prototipo (ms.css). Solo modo claro por ahora. */
object Ms {
    val Bg = Color(0xFFF4F6FB)
    val Surface = Color(0xFFFFFFFF)
    val Hover = Color(0xFFE7EBF4)
    val Line = Color(0xFFD6DCE8)
    val Fg = Color(0xFF0B1020)
    val Muted = Color(0xFF4A5470)
    val Accent = Color(0xFF2B47D3)
    val AccentSoft = Color(0xFFE8ECFF)
    val Ok = Color(0xFF047857)
    val OkSoft = Color(0xFFD1FAE5)
    val Warn = Color(0xFF92400E)
    val WarnSoft = Color(0xFFFEF3C7)
    val Hand = Color(0xFFF59E0B)
    val Danger = Color(0xFFB91C1C)
    val DangerSoft = Color(0xFFFEE2E2)
    val Stage = Color(0xFF0B1020)
}

@OptIn(ExperimentalTextApi::class)
private fun variable(res: Int, weight: Int) =
    Font(res, FontWeight(weight), variationSettings = FontVariation.Settings(FontVariation.weight(weight)))

/** Inter para todo; Montserrat solo en 5 o 6 titulos de marca (prototipo, «Movimiento y tipografia»). */
val Inter = FontFamily(listOf(400, 500, 600, 700).map { variable(R.font.inter, it) })
val Montserrat = FontFamily(listOf(700, 800).map { variable(R.font.montserrat, it) })

private val colors = lightColorScheme(
    primary = Ms.Fg,
    onPrimary = Color.White,
    secondary = Ms.Accent,
    onSecondary = Color.White,
    secondaryContainer = Ms.AccentSoft,
    onSecondaryContainer = Ms.Accent,
    background = Ms.Bg,
    onBackground = Ms.Fg,
    surface = Ms.Surface,
    onSurface = Ms.Fg,
    surfaceVariant = Ms.Hover,
    onSurfaceVariant = Ms.Muted,
    surfaceContainer = Ms.Surface,
    surfaceContainerHigh = Ms.Surface,
    surfaceContainerHighest = Ms.Hover,
    outline = Ms.Line,
    outlineVariant = Ms.Line,
    error = Ms.Danger,
    errorContainer = Ms.DangerSoft
)

private fun t(size: Int, weight: Int, line: Int, family: FontFamily = Inter, spacing: Float = 0f) =
    TextStyle(fontFamily = family, fontSize = size.sp, fontWeight = FontWeight(weight), lineHeight = line.sp, letterSpacing = spacing.sp)

/** Titulos de marca: Montserrat 700. */
val DisplayStyle = t(28, 700, 34, Montserrat, -0.4f)

private val typography = Typography(
    displaySmall = DisplayStyle,
    headlineMedium = t(24, 700, 30, Montserrat, -0.3f),
    headlineSmall = t(20, 700, 26),
    titleLarge = t(20, 700, 26),
    titleMedium = t(16, 600, 22),
    titleSmall = t(14, 600, 20),
    bodyLarge = t(16, 400, 24),
    bodyMedium = t(14, 400, 20),
    bodySmall = t(12, 400, 16),
    labelLarge = t(15, 600, 20),
    labelMedium = t(13, 600, 18),
    labelSmall = t(12, 500, 16, spacing = 0.2f)
)

@Composable
fun MirrorStudioTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = colors, typography = typography, content = content)
}
