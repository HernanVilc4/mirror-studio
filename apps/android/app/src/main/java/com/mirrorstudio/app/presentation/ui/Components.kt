package com.mirrorstudio.app.presentation.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.OffsetMapping
import androidx.compose.ui.text.input.TransformedText
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.mirrorstudio.app.presentation.motion.Motion
import com.mirrorstudio.app.presentation.motion.pressScale
import com.mirrorstudio.app.presentation.theme.Inter
import com.mirrorstudio.app.presentation.theme.Ms

enum class BtnKind { Primary, Secondary, Ghost, Danger, Accent }

/**
 * Boton del prototipo (`.btn`). Se hunde al 96 % al pulsar. Con [progress] no nulo se llena como una barra de
 * progreso (el «Entrar» mientras se conecta).
 */
@Composable
fun MsButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    kind: BtnKind = BtnKind.Primary,
    icon: ImageVector? = null,
    trailing: ImageVector? = null,
    enabled: Boolean = true,
    large: Boolean = false,
    small: Boolean = false,
    progress: Float? = null
) {
    val interaction = remember { MutableInteractionSource() }
    val (bg, fg, border) = when (kind) {
        BtnKind.Primary -> Triple(Ms.Fg, Color.White, null)
        BtnKind.Accent -> Triple(Ms.Accent, Color.White, null)
        BtnKind.Secondary -> Triple(Ms.Surface, Ms.Fg, Ms.Line)
        BtnKind.Ghost -> Triple(Color.Transparent, Ms.Fg, null)
        BtnKind.Danger -> Triple(Ms.DangerSoft, Ms.Danger, null)
    }
    val h = when { large -> 56.dp; small -> 36.dp; else -> 48.dp }
    val shape = RoundedCornerShape(if (small) 10.dp else 14.dp)
    val fill by animateFloatAsState(progress ?: 0f, tween(400, easing = Motion.Ease), label = "relleno")
    Box(
        modifier
            .pressScale(interaction)
            .height(h)
            .clip(shape)
            .background(if (enabled || progress != null) bg else bg.copy(alpha = 0.45f))
            .then(if (border != null) Modifier.border(1.dp, border, shape) else Modifier)
            .clickable(interaction, indication = androidx.compose.material3.ripple(color = fg), enabled = enabled && progress == null, role = Role.Button, onClick = onClick),
        contentAlignment = Alignment.Center
    ) {
        if (progress != null) {
            Box(Modifier.fillMaxHeight().fillMaxWidth(fill.coerceIn(0f, 1f)).align(Alignment.CenterStart).background(Ms.Accent))
        }
        Row(
            Modifier.padding(horizontal = if (small) 14.dp else 18.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.Center
        ) {
            if (icon != null) { Icon(icon, null, tint = fg, modifier = Modifier.size(if (small) 16.dp else 20.dp)); Spacer(Modifier.width(8.dp)) }
            Text(text, color = fg, style = if (small) MaterialTheme.typography.labelMedium else MaterialTheme.typography.labelLarge)
            if (trailing != null) { Spacer(Modifier.width(8.dp)); Icon(trailing, null, tint = fg, modifier = Modifier.size(20.dp)) }
        }
    }
}

/** Boton redondo de icono (`.round`). */
@Composable
fun RoundButton(
    icon: ImageVector,
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    size: Dp = 44.dp,
    bg: Color = Ms.Surface,
    fg: Color = Ms.Fg,
    bordered: Boolean = true,
    enabled: Boolean = true
) {
    val interaction = remember { MutableInteractionSource() }
    Box(
        modifier
            .pressScale(interaction, 0.92f)
            .size(size)
            .clip(CircleShape)
            .background(bg)
            .then(if (bordered) Modifier.border(1.dp, Ms.Line, CircleShape) else Modifier)
            .clickable(interaction, indication = androidx.compose.material3.ripple(), enabled = enabled, role = Role.Button, onClick = onClick)
            .semantics { contentDescription = label },
        contentAlignment = Alignment.Center
    ) { Icon(icon, null, tint = if (enabled) fg else fg.copy(alpha = 0.4f), modifier = Modifier.size(size * 0.45f)) }
}

/** Campo con etiqueta encima (`.field` + `.input`). */
@Composable
fun MsField(
    label: String,
    value: String,
    onChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    error: String? = null,
    hint: String? = null,
    placeholder: String? = null,
    keyboard: KeyboardType = KeyboardType.Text,
    caps: KeyboardCapitalization = KeyboardCapitalization.None,
    imeAction: ImeAction = ImeAction.Next,
    onIme: () -> Unit = {},
    enabled: Boolean = true,
    mono: Boolean = false,
    singleLine: Boolean = true,
    minHeight: Dp = 52.dp,
    visualTransformation: VisualTransformation = VisualTransformation.None
) {
    var focused by remember { mutableStateOf(false) }
    val borderColor = when { error != null -> Ms.Danger; focused -> Ms.Accent; else -> Ms.Line }
    Column(modifier) {
        Text(label, style = MaterialTheme.typography.labelMedium, color = Ms.Muted, modifier = Modifier.padding(bottom = 6.dp, start = 2.dp))
        BasicTextField(
            value = value,
            onValueChange = onChange,
            enabled = enabled,
            singleLine = singleLine,
            textStyle = TextStyle(fontFamily = Inter, fontSize = if (mono) 20.sp else 16.sp, letterSpacing = if (mono) 2.sp else 0.sp, color = Ms.Fg),
            visualTransformation = visualTransformation,
            cursorBrush = SolidColor(Ms.Accent),
            keyboardOptions = KeyboardOptions(keyboardType = keyboard, capitalization = caps, autoCorrectEnabled = false, imeAction = imeAction),
            keyboardActions = KeyboardActions(onAny = { onIme() }),
            modifier = Modifier
                .fillMaxWidth()
                .onFocusChanged { focused = it.isFocused }
                .semantics { contentDescription = label },
            decorationBox = { inner ->
                Box(
                    Modifier
                        .fillMaxWidth()
                        .height(if (singleLine) minHeight else Dp.Unspecified)
                        .background(Ms.Surface, RoundedCornerShape(12.dp))
                        .border(if (focused || error != null) 2.dp else 1.dp, borderColor, RoundedCornerShape(12.dp))
                        .padding(horizontal = 14.dp, vertical = if (singleLine) 0.dp else 12.dp),
                    contentAlignment = Alignment.CenterStart
                ) {
                    if (value.isEmpty() && placeholder != null) Text(placeholder, color = Ms.Muted.copy(alpha = 0.55f), style = MaterialTheme.typography.bodyLarge)
                    inner()
                }
            }
        )
        AnimatedVisibility(error != null || hint != null, enter = fadeIn() + expandVertically(), exit = fadeOut() + shrinkVertically()) {
            Text(
                error ?: hint.orEmpty(),
                style = MaterialTheme.typography.bodySmall,
                color = if (error != null) Ms.Danger else Ms.Muted,
                modifier = Modifier.padding(top = 6.dp, start = 2.dp)
            )
        }
    }
}

/** Encabezado de pantalla interior: volver + titulo + acciones. */
@Composable
fun ScreenHeader(title: String, onBack: (() -> Unit)?, modifier: Modifier = Modifier, actions: @Composable RowScope.() -> Unit = {}) {
    Row(modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        if (onBack != null) { RoundButton(Ic.Back, "Volver", onBack); Spacer(Modifier.width(12.dp)) }
        Text(title, style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
        actions()
    }
}

/** Aviso en caja de color (error, advertencia, informacion). */
@Composable
fun Callout(text: String, modifier: Modifier = Modifier, tone: Tone = Tone.Danger, icon: ImageVector? = Ic.Alert, title: String? = null) {
    val (bg, fg) = when (tone) {
        Tone.Danger -> Ms.DangerSoft to Ms.Danger
        Tone.Warn -> Ms.WarnSoft to Ms.Warn
        Tone.Info -> Ms.AccentSoft to Ms.Accent
        Tone.Ok -> Ms.OkSoft to Ms.Ok
    }
    Row(modifier.fillMaxWidth().background(bg, RoundedCornerShape(14.dp)).padding(14.dp)) {
        if (icon != null) { Icon(icon, null, tint = fg, modifier = Modifier.size(20.dp)); Spacer(Modifier.width(10.dp)) }
        Column {
            if (title != null) Text(title, style = MaterialTheme.typography.titleSmall, color = fg)
            Text(text, style = MaterialTheme.typography.bodyMedium, color = if (title != null) Ms.Fg else fg)
        }
    }
}

enum class Tone { Danger, Warn, Info, Ok }

/** Tarjeta blanca con borde (`.card`). */
@Composable
fun Card(modifier: Modifier = Modifier, padding: PaddingValues = PaddingValues(16.dp), onClick: (() -> Unit)? = null, content: @Composable () -> Unit) {
    val interaction = remember { MutableInteractionSource() }
    Box(
        modifier
            .then(if (onClick != null) Modifier.pressScale(interaction, 0.98f) else Modifier)
            .clip(RoundedCornerShape(16.dp))
            .background(Ms.Surface)
            .border(1.dp, Ms.Line, RoundedCornerShape(16.dp))
            .then(if (onClick != null) Modifier.clickable(interaction, indication = androidx.compose.material3.ripple(), onClick = onClick) else Modifier)
            .padding(padding)
    ) { content() }
}

/** Circulo con iniciales. */
@Composable
fun Avatar(name: String, modifier: Modifier = Modifier, size: Dp = 36.dp, highlight: Boolean = false) {
    Box(modifier.size(size).background(if (highlight) Ms.AccentSoft else Ms.Hover, CircleShape), contentAlignment = Alignment.Center) {
        Text(initials(name), style = MaterialTheme.typography.labelMedium, color = if (highlight) Ms.Accent else Ms.Fg)
    }
}

fun initials(name: String): String =
    name.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }.take(2).joinToString("") { it.first().uppercase() }.ifEmpty { "?" }

/** Etiqueta pequena (`.chip`). */
@Composable
fun Chip(text: String, modifier: Modifier = Modifier, bg: Color = Ms.AccentSoft, fg: Color = Ms.Accent) {
    Text(text, style = MaterialTheme.typography.labelSmall, color = fg, modifier = modifier.background(bg, RoundedCornerShape(50)).padding(horizontal = 10.dp, vertical = 4.dp))
}

/** Muestra un codigo de 8 caracteres como K7Q4-M2XP sin tocar el texto guardado (el cursor no salta). */
object CodeVisualTransformation : VisualTransformation {
    override fun filter(text: AnnotatedString): TransformedText {
        val raw = text.text
        val shown = if (raw.length > 4) raw.take(4) + "-" + raw.drop(4) else raw
        val map = object : OffsetMapping {
            override fun originalToTransformed(offset: Int) = if (offset > 4) offset + 1 else offset
            override fun transformedToOriginal(offset: Int) = if (offset > 4) offset - 1 else offset
        }
        return TransformedText(AnnotatedString(shown), map)
    }
}
