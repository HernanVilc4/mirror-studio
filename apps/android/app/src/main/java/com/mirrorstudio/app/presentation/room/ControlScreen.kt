package com.mirrorstudio.app.presentation.room

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChange
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import com.mirrorstudio.app.presentation.media.VideoView
import com.mirrorstudio.app.presentation.motion.rememberTick
import com.mirrorstudio.app.presentation.theme.Ms
import com.mirrorstudio.app.presentation.ui.BtnKind
import com.mirrorstudio.app.presentation.ui.Callout
import com.mirrorstudio.app.presentation.ui.Ic
import com.mirrorstudio.app.presentation.ui.MsButton
import com.mirrorstudio.app.presentation.ui.RoundButton
import com.mirrorstudio.app.presentation.ui.Tone
import com.mirrorstudio.protocol.KeyEvent
import com.mirrorstudio.protocol.MouseButton
import com.mirrorstudio.protocol.MouseButtonKind
import com.mirrorstudio.protocol.MouseMove
import com.mirrorstudio.protocol.TextEvent
import com.mirrorstudio.protocol.Wheel
import kotlinx.coroutines.delay
import org.webrtc.EglBase
import org.webrtc.VideoTrack
import kotlin.math.abs

private enum class Mode { TOUCHPAD, TAP }

/**
 * Pantallas 08 y 09: el telefono como touchpad de otra PC. Un dedo mueve el puntero, tocar es clic, doble
 * toque doble clic, dos dedos desplazan y mantener es clic derecho. En «Tocar la imagen» se toca directamente
 * donde se quiere hacer clic.
 */
@Composable
fun ControlScreen(viewModel: RoomViewModel, target: String, track: VideoTrack?, egl: EglBase, problem: String?) {
    com.mirrorstudio.app.presentation.ui.DarkSystemBars()
    var mode by rememberSaveable { mutableStateOf(Mode.TOUCHPAD) }
    var cursorX by remember { mutableFloatStateOf(0.5f) }
    var cursorY by remember { mutableFloatStateOf(0.5f) }
    var frame by remember { mutableStateOf(16 to 9) }
    var keyboard by remember { mutableStateOf(false) }
    val tick = rememberTick()
    BackHandler { viewModel.stopControl() }

    fun move(x: Float, y: Float) {
        cursorX = x.coerceIn(0f, 1f); cursorY = y.coerceIn(0f, 1f)
        viewModel.send(MouseMove(cursorX.toDouble(), cursorY.toDouble()))
    }
    fun click(b: MouseButtonKind = MouseButtonKind.LEFT) {
        viewModel.send(MouseButton(b, true)); viewModel.send(MouseButton(b, false))
    }

    Column(Modifier.fillMaxSize().background(Ms.Stage)) {
        Row(
            Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 16.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(Modifier.weight(1f)) {
                Text("Controlando", style = MaterialTheme.typography.labelSmall, color = Color.White.copy(alpha = 0.6f))
                Text(target, style = MaterialTheme.typography.titleMedium, color = Color.White)
            }
            RoundButton(Ic.Refresh, "Reintentar el control", viewModel::resetControl, bg = Color.White.copy(alpha = 0.12f), fg = Color.White, bordered = false)
            Spacer(Modifier.width(8.dp))
            RoundButton(Ic.Close, "Dejar de controlar", viewModel::stopControl, bg = Ms.Danger, fg = Color.White, bordered = false)
        }
        AnimatedVisibility(problem != null, enter = fadeIn() + expandVertically(), exit = fadeOut() + shrinkVertically()) {
            Callout(problem.orEmpty(), Modifier.padding(horizontal = 16.dp, vertical = 4.dp), tone = Tone.Warn, icon = Ic.Lock)
        }
        // La PC controlada; en modo «Tocar la imagen», el toque va a ese punto.
        BoxWithConstraints(
            Modifier.fillMaxWidth().aspectRatio(16f / 10f).padding(horizontal = 8.dp).clip(RoundedCornerShape(12.dp)).background(Color.Black)
                .pointerInput(mode, frame) {
                    if (mode != Mode.TAP) return@pointerInput
                    detectTapGestures(
                        onTap = { p -> imagePoint(p.x, p.y, size.width.toFloat(), size.height.toFloat(), frame)?.let { (x, y) -> move(x, y); click() } },
                        onLongPress = { p -> imagePoint(p.x, p.y, size.width.toFloat(), size.height.toFloat(), frame)?.let { (x, y) -> move(x, y); tick(); click(MouseButtonKind.RIGHT) } }
                    )
                },
            contentAlignment = Alignment.Center
        ) {
            if (track != null) VideoView(track, egl, Modifier.fillMaxSize(), onFrameSize = { w, h -> frame = w to h })
            else Text("Esperando la imagen de la PC…", color = Color.White.copy(alpha = 0.7f))
        }
        Row(Modifier.fillMaxWidth().padding(16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            ModeTab("Touchpad", mode == Mode.TOUCHPAD, Modifier.weight(1f)) { mode = Mode.TOUCHPAD }
            ModeTab("Tocar la imagen", mode == Mode.TAP, Modifier.weight(1f)) { mode = Mode.TAP }
        }
        if (mode == Mode.TOUCHPAD) {
            Touchpad(
                Modifier.weight(1f).fillMaxWidth().padding(horizontal = 16.dp),
                onMove = { dx, dy -> move(cursorX + dx, cursorY + dy) },
                onTap = { click() },
                onDoubleTap = { click(); click() },
                onLongPress = { tick(); click(MouseButtonKind.RIGHT) },
                onScroll = { dx, dy -> viewModel.send(Wheel(dx, dy)) }
            )
        } else Spacer(Modifier.weight(1f))
        if (keyboard) HiddenKeyboard(
            onText = { viewModel.send(TextEvent(it)) },
            onKey = { code -> viewModel.send(KeyEvent(code, true)); viewModel.send(KeyEvent(code, false)) },
            onClose = { keyboard = false }
        )
        Row(
            Modifier.fillMaxWidth().navigationBarsPadding().padding(16.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            MsButton("Clic", { click() }, Modifier.weight(1f), kind = BtnKind.Secondary)
            MsButton("Clic der.", { click(MouseButtonKind.RIGHT) }, Modifier.weight(1f), kind = BtnKind.Secondary)
            MsButton("Teclado", { keyboard = !keyboard }, Modifier.weight(1f), kind = if (keyboard) BtnKind.Accent else BtnKind.Secondary, icon = Ic.Keyboard)
        }
    }
}

/** De un toque sobre la vista a coordenadas 0..1 de la imagen, sin contar las franjas negras. */
private fun imagePoint(px: Float, py: Float, w: Float, h: Float, frame: Pair<Int, Int>): Pair<Float, Float>? {
    val ar = frame.first.toFloat() / frame.second.coerceAtLeast(1)
    val (iw, ih) = if (w / h > ar) h * ar to h else w to w / ar
    val x = (px - (w - iw) / 2) / iw
    val y = (py - (h - ih) / 2) / ih
    return if (x in 0f..1f && y in 0f..1f) x to y else null
}

@Composable
private fun ModeTab(text: String, selected: Boolean, modifier: Modifier, onClick: () -> Unit) {
    MsButton(text, onClick, modifier, kind = if (selected) BtnKind.Accent else BtnKind.Ghost, small = true)
}

@Composable
private fun Touchpad(
    modifier: Modifier,
    onMove: (Float, Float) -> Unit,
    onTap: () -> Unit,
    onDoubleTap: () -> Unit,
    onLongPress: () -> Unit,
    onScroll: (Int, Int) -> Unit
) {
    Box(
        modifier
            .clip(RoundedCornerShape(20.dp))
            .background(Color.White.copy(alpha = 0.06f))
            .border(1.dp, Color.White.copy(alpha = 0.15f), RoundedCornerShape(20.dp))
            .pointerInput(Unit) { detectTapGestures(onTap = { onTap() }, onDoubleTap = { onDoubleTap() }, onLongPress = { onLongPress() }) }
            .pointerInput(Unit) {
                // Un dedo mueve el puntero (con aceleracion suave); dos dedos desplazan.
                awaitEachGesture {
                    awaitFirstDown(requireUnconsumed = false)
                    var scrollX = 0f
                    var scrollY = 0f
                    do {
                        val event = awaitPointerEvent()
                        val pressed = event.changes.filter { it.pressed }
                        if (pressed.size >= 2) {
                            val d = pressed.first().positionChange()
                            scrollX += d.x; scrollY += d.y
                            if (abs(scrollY) > 8 || abs(scrollX) > 8) {
                                onScroll((-scrollX * 3).toInt(), (-scrollY * 3).toInt()); scrollX = 0f; scrollY = 0f
                            }
                            pressed.forEach { it.consume() }
                        } else if (pressed.size == 1) {
                            val d = pressed.first().positionChange()
                            if (d.x != 0f || d.y != 0f) {
                                val speed = kotlin.math.sqrt(d.x * d.x + d.y * d.y)
                                val gain = 1.2f + (speed / 30f).coerceAtMost(2f)
                                onMove(d.x * gain / size.width, d.y * gain / size.width * 1.6f)
                                if (speed > 2f) pressed.first().consume()
                            }
                        }
                    } while (event.changes.any { it.pressed })
                }
            },
        contentAlignment = Alignment.Center
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(Ic.Pointer, null, tint = Color.White.copy(alpha = 0.35f), modifier = Modifier.size(28.dp))
            Spacer(Modifier.height(8.dp))
            Text("Un dedo: mover el puntero", color = Color.White.copy(alpha = 0.55f), style = MaterialTheme.typography.bodySmall)
            Text("Tocar: clic · Doble toque: doble clic", color = Color.White.copy(alpha = 0.55f), style = MaterialTheme.typography.bodySmall)
            Text("Dos dedos: desplazar · Mantener: clic derecho", color = Color.White.copy(alpha = 0.55f), style = MaterialTheme.typography.bodySmall)
        }
    }
}

/** Campo invisible que abre el teclado del telefono y manda lo que se escribe a la PC. */
@Composable
private fun HiddenKeyboard(onText: (String) -> Unit, onKey: (String) -> Unit, onClose: () -> Unit) {
    val focus = remember { FocusRequester() }
    val kb = LocalSoftwareKeyboardController.current
    var value by remember { mutableStateOf(" ") }
    LaunchedEffect(Unit) { delay(50); focus.requestFocus(); kb?.show() }
    BasicTextField(
        value = value,
        onValueChange = { v ->
            when {
                v.length < value.length -> onKey("Backspace")
                v.length > value.length -> onText(v.substring(value.length))
            }
            value = " "
        },
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send, autoCorrectEnabled = false),
        keyboardActions = KeyboardActions(onSend = { onKey("Enter") }),
        modifier = Modifier.size(1.dp).focusRequester(focus).onKeyEvent {
            if (it.type == KeyEventType.KeyDown && it.key == Key.Enter) { onKey("Enter"); true }
            else if (it.type == KeyEventType.KeyDown && it.key == Key.Back) { onClose(); false } else false
        }
    )
}
