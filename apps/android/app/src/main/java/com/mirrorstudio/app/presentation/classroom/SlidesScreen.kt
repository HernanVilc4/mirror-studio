package com.mirrorstudio.app.presentation.classroom

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.mirrorstudio.app.domain.InkColor
import com.mirrorstudio.app.domain.InkTool
import com.mirrorstudio.app.domain.Member
import com.mirrorstudio.app.domain.SlideAction
import com.mirrorstudio.app.presentation.media.VideoView
import com.mirrorstudio.app.presentation.motion.Motion
import com.mirrorstudio.app.presentation.motion.pressScale
import com.mirrorstudio.app.presentation.theme.Ms
import com.mirrorstudio.app.presentation.ui.BtnKind
import com.mirrorstudio.app.presentation.ui.Ic
import com.mirrorstudio.app.presentation.ui.MsButton
import com.mirrorstudio.app.presentation.ui.RoundButton
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.webrtc.EglBase
import org.webrtc.VideoTrack
import kotlin.math.abs

enum class SlideTool { NONE, LASER, INK }

private val inkColors = mapOf(InkColor.RED to Color(0xFFEF4444), InkColor.BLUE to Color(0xFF2B47D3), InkColor.YELLOW to Color(0xFFFACC15), InkColor.BLACK to Color(0xFF0B1020))

private class LocalStroke(val color: InkColor, val width: Int, val tool: InkTool) { val points = mutableStateListOf<Offset>() }

/**
 * Pantallas 17, 18 y 19: el telefono vinculado pasa diapositivas, usa el laser y anota sobre lo que presenta
 * su PC. Tambien con los botones de volumen (bajar = siguiente) y deslizando sobre la diapositiva.
 */
@Composable
fun SlidesScreen(
    vm: ClassroomViewModel,
    pc: Member,
    presenting: Boolean,
    track: VideoTrack?,
    egl: EglBase,
    unread: Int,
    onMessages: () -> Unit,
    onClose: () -> Unit
) {
    com.mirrorstudio.app.presentation.ui.DarkSystemBars()
    var tool by rememberSaveable { mutableStateOf(SlideTool.NONE) }
    var black by rememberSaveable { mutableStateOf(false) }
    var frame by remember { mutableStateOf(16 to 9) }
    val shift = remember { Animatable(0f) }
    val scope = rememberCoroutineScope()
    val strokes = remember { mutableStateListOf<LocalStroke>() }
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { focus.requestFocus() }
    BackHandler { if (tool != SlideTool.NONE) tool = SlideTool.NONE else onClose() }

    // La diapositiva sale hacia un lado y entra la siguiente por el otro (220 ms).
    fun go(a: SlideAction) {
        vm.slide(a)
        strokes.clear()
        val dir = if (a == SlideAction.PREV) 1f else -1f
        scope.launch { shift.snapTo(0f); shift.animateTo(dir, tween(110)); shift.snapTo(-dir); shift.animateTo(0f, tween(110, easing = Motion.Ease)) }
    }

    Column(
        Modifier.fillMaxSize().background(Ms.Stage).focusRequester(focus).focusable()
            .onPreviewKeyEvent {
                if (it.type != KeyEventType.KeyDown) return@onPreviewKeyEvent it.key == Key.VolumeDown || it.key == Key.VolumeUp
                when (it.key) {
                    Key.VolumeDown -> { go(SlideAction.NEXT); true }
                    Key.VolumeUp -> { go(SlideAction.PREV); true }
                    else -> false
                }
            }
    ) {
        Row(Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(pc.name, style = MaterialTheme.typography.labelSmall, color = Color.White.copy(alpha = 0.6f))
                Text(
                    when (tool) { SlideTool.LASER -> "Puntero láser"; SlideTool.INK -> "Anotar"; SlideTool.NONE -> "Diapositivas" },
                    style = MaterialTheme.typography.titleMedium, color = Color.White
                )
            }
            Timer()
            Spacer(Modifier.width(8.dp))
            RoundButton(Ic.Close, "Cerrar", { if (tool != SlideTool.NONE) tool = SlideTool.NONE else onClose() }, bg = Color.White.copy(alpha = 0.12f), fg = Color.White, bordered = false)
        }

        // La diapositiva en vivo, con el laser o los trazos encima.
        BoxWithConstraints(
            Modifier.fillMaxWidth().aspectRatio(16f / 10f).padding(horizontal = 12.dp).clip(RoundedCornerShape(14.dp)).background(Color.Black)
                .graphicsLayer { translationX = shift.value * 40.dp.toPx(); alpha = 1f - abs(shift.value) * 0.6f }
                .pointerInput(tool) {
                    if (tool != SlideTool.NONE) return@pointerInput
                    var total = 0f
                    detectHorizontalDragGestures(onDragStart = { total = 0f }, onDragEnd = {
                        if (total < -60) go(SlideAction.NEXT) else if (total > 60) go(SlideAction.PREV)
                    }) { _, d -> total += d }
                }
        ) {
            if (track != null && presenting) VideoView(track, egl, Modifier.fillMaxSize(), onFrameSize = { w, h -> frame = w to h })
            else Column(Modifier.align(Alignment.Center).padding(20.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Icon(Ic.Monitor, null, tint = Color.White.copy(alpha = 0.5f), modifier = Modifier.size(32.dp))
                Text(if (presenting) "Conectando el video…" else "${pc.name} no está presentando", color = Color.White, style = MaterialTheme.typography.titleSmall)
                if (!presenting) Text("Los botones igual envían las teclas a tu PC.", color = Color.White.copy(alpha = 0.6f), style = MaterialTheme.typography.bodySmall)
            }
            val w = constraints.maxWidth.toFloat(); val h = constraints.maxHeight.toFloat()
            val ar = frame.first.toFloat() / frame.second.coerceAtLeast(1)
            val (iw, ih) = if (w / h > ar) h * ar to h else w to w / ar
            val ox = (w - iw) / 2; val oy = (h - ih) / 2
            when (tool) {
                SlideTool.LASER -> LaserLayer(Modifier.fillMaxSize(), ox, oy, iw, ih) { x, y, on -> vm.pointer(x, y, on) }
                SlideTool.INK -> InkLayer(Modifier.fillMaxSize(), ox, oy, iw, ih, strokes, vm)
                SlideTool.NONE -> if (strokes.isNotEmpty()) InkPreview(Modifier.fillMaxSize(), ox, oy, iw, ih, strokes)
            }
        }

        Spacer(Modifier.height(16.dp))
        when (tool) {
            SlideTool.NONE -> {
                Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    BigButton("Anterior", Ic.Back, Modifier.weight(1f)) { go(SlideAction.PREV) }
                    BigButton("Siguiente", Ic.Next, Modifier.weight(1.4f), primary = true) { go(SlideAction.NEXT) }
                }
                Spacer(Modifier.weight(1f))
                Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), horizontalArrangement = Arrangement.SpaceEvenly) {
                    ToolItem(Ic.Square, if (black) "Volver" else "Negro", black) { black = !black; vm.slide(SlideAction.BLACK) }
                    ToolItem(Ic.Laser, "Láser", false) { tool = SlideTool.LASER }
                    ToolItem(Ic.Pen, "Anotar", false) { tool = SlideTool.INK }
                    ToolItem(Ic.Chat, if (unread > 0) "Mensajes ($unread)" else "Mensajes", unread > 0, onMessages)
                    ToolItem(Ic.Play, "Iniciar", false) { vm.slide(SlideAction.START) }
                }
                Text(
                    "También puedes deslizar sobre la diapositiva o usar los botones de volumen.",
                    style = MaterialTheme.typography.bodySmall, color = Color.White.copy(alpha = 0.55f),
                    modifier = Modifier.navigationBarsPadding().padding(16.dp)
                )
            }
            SlideTool.LASER -> LaserControls(vm) { tool = SlideTool.NONE }
            SlideTool.INK -> InkControls(vm, strokes) { tool = SlideTool.NONE }
        }
    }
}

@Composable
private fun BigButton(text: String, icon: ImageVector, modifier: Modifier, primary: Boolean = false, onClick: () -> Unit) {
    val interaction = remember { androidx.compose.foundation.interaction.MutableInteractionSource() }
    Column(
        modifier.pressScale(interaction).height(110.dp).clip(RoundedCornerShape(20.dp))
            .background(if (primary) Ms.Accent else Color.White.copy(alpha = 0.1f))
            .clickable(interaction, androidx.compose.material3.ripple(color = Color.White), onClick = onClick),
        verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Icon(icon, null, tint = Color.White, modifier = Modifier.size(34.dp))
        Text(text, color = Color.White, style = MaterialTheme.typography.titleMedium)
    }
}

@Composable
private fun ToolItem(icon: ImageVector, label: String, active: Boolean, onClick: () -> Unit) {
    Column(
        Modifier.clip(RoundedCornerShape(14.dp)).clickable(onClick = onClick).padding(horizontal = 8.dp, vertical = 6.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Box(Modifier.size(48.dp).background(if (active) Ms.Accent else Color.White.copy(alpha = 0.1f), CircleShape), contentAlignment = Alignment.Center) {
            Icon(icon, null, tint = Color.White, modifier = Modifier.size(22.dp))
        }
        Spacer(Modifier.height(4.dp))
        Text(label, color = Color.White.copy(alpha = 0.8f), style = MaterialTheme.typography.labelSmall)
    }
}

/** Temporizador: cuenta lo que va de la clase; mantener pulsado pone una cuenta atras que avisa con dos vibraciones. */
@Composable
private fun Timer() {
    val context = LocalContext.current
    var start by rememberSaveable { mutableLongStateOf(System.currentTimeMillis()) }
    var limitMin by rememberSaveable { mutableIntStateOf(0) }
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    var ask by remember { mutableStateOf(false) }
    val blink = remember { Animatable(1f) }
    var fired by remember(limitMin, start) { mutableStateOf(false) }
    LaunchedEffect(Unit) { while (true) { now = System.currentTimeMillis(); delay(500) } }
    val elapsed = (now - start) / 1000
    val shown = if (limitMin > 0) (limitMin * 60L - elapsed) else elapsed
    LaunchedEffect(shown <= 0 && limitMin > 0) {
        if (shown <= 0 && limitMin > 0 && !fired) {
            fired = true
            buzzTwice(context)
            repeat(2) { blink.animateTo(0.2f, tween(150)); blink.animateTo(1f, tween(150)) }
        }
    }
    val v = abs(shown)
    Text(
        (if (shown < 0) "+" else "") + "%d:%02d".format(v / 60, v % 60),
        color = if (limitMin > 0 && shown <= 60) Color(0xFFFCD34D) else Color.White,
        style = MaterialTheme.typography.titleMedium,
        modifier = Modifier.graphicsLayer { alpha = blink.value }.clip(RoundedCornerShape(50)).background(Color.White.copy(alpha = 0.1f))
            .combinedClickable(onClick = { start = System.currentTimeMillis() }, onLongClick = { ask = true })
            .padding(horizontal = 12.dp, vertical = 6.dp)
    )
    if (ask) AlertDialog(
        onDismissRequest = { ask = false },
        title = { Text("Temporizador") },
        text = {
            Column {
                Text("Tocar el reloj lo reinicia. Elige una cuenta atrás:")
                listOf(0, 5, 10, 15, 20, 30, 45).forEach { m ->
                    TextButton(onClick = { limitMin = m; start = System.currentTimeMillis(); ask = false }) { Text(if (m == 0) "Sin límite" else "$m minutos") }
                }
            }
        },
        confirmButton = {}, containerColor = Ms.Surface
    )
}

private fun buzzTwice(context: Context) {
    val v = context.getSystemService(Vibrator::class.java) ?: return
    if (Build.VERSION.SDK_INT >= 26) v.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 120, 120, 120), -1))
}

/**
 * Pantalla 18: el punto rojo con halo aparece bajo el dedo, lo sigue con una estela corta y se desvanece al
 * soltar. Envia como mucho 30 posiciones por segundo (el anfitrion admite 40).
 */
@Composable
private fun LaserLayer(modifier: Modifier, ox: Float, oy: Float, iw: Float, ih: Float, send: (Float, Float, Boolean) -> Unit) {
    val trail = remember { mutableStateListOf<Offset>() }
    val fade = remember { Animatable(0f) }
    val scope = rememberCoroutineScope()
    Canvas(
        modifier.pointerInput(ox, oy, iw, ih) {
            awaitEachGesture {
                val down = awaitFirstDown()
                scope.launch { fade.snapTo(1f) }
                var last = 0L
                fun emit(p: Offset, on: Boolean) {
                    val t = System.currentTimeMillis()
                    if (on && t - last < 33) return
                    last = t
                    send(((p.x - ox) / iw).coerceIn(0f, 1f), ((p.y - oy) / ih).coerceIn(0f, 1f), on)
                }
                trail.clear(); trail.add(down.position); emit(down.position, true)
                do {
                    val e = awaitPointerEvent()
                    val c = e.changes.first()
                    if (c.pressed) { trail.add(c.position); if (trail.size > 8) trail.removeAt(0); emit(c.position, true); c.consume() }
                } while (e.changes.any { it.pressed })
                emit(trail.lastOrNull() ?: down.position, false)
                scope.launch { fade.animateTo(0f, tween(200)); trail.clear() }
            }
        }
    ) {
        trail.forEachIndexed { i, p -> drawCircle(Color(0xFFEF4444), 3.dp.toPx() + i, p, alpha = fade.value * (i + 1) / trail.size * 0.5f) }
        trail.lastOrNull()?.let {
            drawCircle(Color(0xFFEF4444), 18.dp.toPx(), it, alpha = 0.25f * fade.value)
            drawCircle(Color(0xFFEF4444), 7.dp.toPx(), it, alpha = fade.value)
        }
    }
}

@Composable
private fun ColumnScope.LaserControls(vm: ClassroomViewModel, onDone: () -> Unit) {
    var motion by rememberSaveable { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Sobre la presentación de tu PC", style = MaterialTheme.typography.labelSmall, color = Color.White.copy(alpha = 0.6f))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            MsButton("Con el dedo", { motion = false }, Modifier.weight(1f), kind = if (!motion) BtnKind.Accent else BtnKind.Secondary, small = true)
            MsButton("Moviendo el teléfono", { motion = true }, Modifier.weight(1f), kind = if (motion) BtnKind.Accent else BtnKind.Secondary, small = true)
        }
        if (motion) MotionLaser(vm)
        else Text(
            "Mantén pulsado sobre la diapositiva y mueve el dedo. El punto aparece en la PC y lo ven todos. Al soltar, desaparece.",
            style = MaterialTheme.typography.bodyMedium, color = Color.White.copy(alpha = 0.8f)
        )
    }
    Spacer(Modifier.weight(1f))
    MsButton("Listo", onDone, Modifier.fillMaxWidth().navigationBarsPadding().padding(16.dp), kind = BtnKind.Secondary)
}

/** Mientras se mantiene el boton, girar el telefono mueve el punto (sensor de rotacion, sin brujula). */
@Composable
private fun MotionLaser(vm: ClassroomViewModel) {
    val context = LocalContext.current
    var holding by remember { mutableStateOf(false) }
    var x by remember { mutableFloatStateOf(0.5f) }
    var y by remember { mutableFloatStateOf(0.5f) }
    DisposableEffect(holding) {
        val sm = context.getSystemService(SensorManager::class.java)
        val sensor = sm?.getDefaultSensor(Sensor.TYPE_GAME_ROTATION_VECTOR) ?: sm?.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR)
        if (!holding || sm == null || sensor == null) return@DisposableEffect onDispose {}
        var base: FloatArray? = null
        var last = 0L
        val listener = object : SensorEventListener {
            override fun onSensorChanged(e: SensorEvent) {
                val r = FloatArray(9); SensorManager.getRotationMatrixFromVector(r, e.values)
                val o = FloatArray(3); SensorManager.getOrientation(r, o)
                val b = base ?: o.copyOf().also { base = it }
                // 30° a cada lado cubren la pantalla.
                x = (0.5f - angle(o[0] - b[0]) / 1.05f).coerceIn(0f, 1f)
                y = (0.5f - (o[1] - b[1]) / 0.8f).coerceIn(0f, 1f)
                val t = System.currentTimeMillis()
                if (t - last >= 33) { last = t; vm.pointer(x, y, true) }
            }
            override fun onAccuracyChanged(s: Sensor?, a: Int) {}
        }
        sm.registerListener(listener, sensor, SensorManager.SENSOR_DELAY_GAME)
        onDispose { sm.unregisterListener(listener); vm.pointer(x, y, false) }
    }
    Box(
        Modifier.fillMaxWidth().height(96.dp).clip(RoundedCornerShape(20.dp)).background(if (holding) Color(0xFFEF4444) else Color.White.copy(alpha = 0.1f))
            .pointerInput(Unit) {
                awaitEachGesture {
                    awaitFirstDown(); holding = true
                    do { val e = awaitPointerEvent() } while (e.changes.any { it.pressed })
                    holding = false
                }
            },
        contentAlignment = Alignment.Center
    ) {
        Text(if (holding) "Apunta moviendo el teléfono" else "Mantén pulsado y apunta", color = Color.White, style = MaterialTheme.typography.titleMedium)
    }
}

private fun angle(a: Float): Float {
    var v = a
    while (v > Math.PI) v -= (2 * Math.PI).toFloat()
    while (v < -Math.PI) v += (2 * Math.PI).toFloat()
    return v
}

/**
 * Pantalla 19: el trazo se dibuja con el dedo y se envia a la PC en trozos de hasta 32 puntos (como mucho
 * ~25 trozos por segundo; el anfitrion admite 60).
 */
@Composable
private fun InkLayer(modifier: Modifier, ox: Float, oy: Float, iw: Float, ih: Float, strokes: MutableList<LocalStroke>, vm: ClassroomViewModel) {
    val pen = LocalInk.current
    Canvas(
        modifier.pointerInput(ox, oy, iw, ih, pen.color, pen.width, pen.tool) {
            awaitEachGesture {
                val down = awaitFirstDown()
                val s = LocalStroke(pen.color, pen.width, pen.tool)
                strokes.add(s)
                val id = pen.nextStroke()
                val pending = mutableListOf<Pair<Float, Float>>()
                var lastSent = 0L
                fun norm(p: Offset) = ((p.x - ox) / iw).coerceIn(0f, 1f) to ((p.y - oy) / ih).coerceIn(0f, 1f)
                fun flush(done: Boolean) {
                    if (pending.isEmpty() && !done) return
                    vm.ink(id, pending.toList(), s.color, s.width, s.tool, done)
                    pending.clear(); lastSent = System.currentTimeMillis()
                }
                s.points.add(down.position); pending.add(norm(down.position))
                do {
                    val e = awaitPointerEvent()
                    val c = e.changes.first()
                    if (c.pressed) {
                        s.points.add(c.position); pending.add(norm(c.position)); c.consume()
                        if (pending.size >= 32 || System.currentTimeMillis() - lastSent > 40) flush(false)
                    }
                } while (e.changes.any { it.pressed })
                flush(true)
            }
        }
    ) { strokes.forEach { drawStroke(it) } }
}

@Composable
private fun InkPreview(modifier: Modifier, ox: Float, oy: Float, iw: Float, ih: Float, strokes: List<LocalStroke>) {
    Canvas(modifier) { strokes.forEach { drawStroke(it) } }
}

private fun androidx.compose.ui.graphics.drawscope.DrawScope.drawStroke(s: LocalStroke) {
    if (s.points.isEmpty()) return
    val path = Path().apply { moveTo(s.points[0].x, s.points[0].y); s.points.drop(1).forEach { lineTo(it.x, it.y) } }
    val hl = s.tool == InkTool.HIGHLIGHTER
    drawPath(
        path, inkColors.getValue(s.color), alpha = if (hl) 0.4f else 1f,
        style = Stroke(width = (s.width * if (hl) 6 else 2).dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round)
    )
}

/** Color, grosor y herramienta elegidos (compartidos entre la capa y la barra). */
private class Pen {
    var color by mutableStateOf(InkColor.RED)
    var width by mutableIntStateOf(2)
    var tool by mutableStateOf(InkTool.PEN)
    private var counter = 0
    fun nextStroke() = counter++
}

private val LocalInk = androidx.compose.runtime.staticCompositionLocalOf { Pen() }

@Composable
private fun ColumnScope.InkControls(vm: ClassroomViewModel, strokes: MutableList<LocalStroke>, onDone: () -> Unit) {
    val pen = LocalInk.current
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Todos ven tus trazos", style = MaterialTheme.typography.labelSmall, color = Color.White.copy(alpha = 0.6f), modifier = Modifier.weight(1f))
            RoundButton(Ic.Undo, "Deshacer", { if (strokes.isNotEmpty()) strokes.removeAt(strokes.lastIndex); vm.inkUndo() }, bg = Color.White.copy(alpha = 0.12f), fg = Color.White, bordered = false)
            Spacer(Modifier.width(8.dp))
            RoundButton(Ic.Trash, "Borrar todo", { strokes.clear(); vm.inkClear() }, bg = Color.White.copy(alpha = 0.12f), fg = Color.White, bordered = false)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
            inkColors.forEach { (c, color) ->
                Box(
                    Modifier.size(36.dp).clip(CircleShape).background(color)
                        .border(if (pen.color == c) 3.dp else 1.dp, if (pen.color == c) Color.White else Color.White.copy(alpha = 0.3f), CircleShape)
                        .clickable { pen.color = c }
                )
            }
            Spacer(Modifier.weight(1f))
            listOf(1, 2, 3).forEach { w ->
                Box(
                    Modifier.size(36.dp).clip(CircleShape).background(if (pen.width == w) Color.White.copy(alpha = 0.25f) else Color.Transparent).clickable { pen.width = w },
                    contentAlignment = Alignment.Center
                ) { Box(Modifier.size((4 + w * 4).dp).background(Color.White, CircleShape)) }
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            MsButton("Lápiz", { pen.tool = InkTool.PEN }, Modifier.weight(1f), kind = if (pen.tool == InkTool.PEN) BtnKind.Accent else BtnKind.Secondary, small = true, icon = Ic.Pen)
            MsButton("Resaltador", { pen.tool = InkTool.HIGHLIGHTER }, Modifier.weight(1f), kind = if (pen.tool == InkTool.HIGHLIGHTER) BtnKind.Accent else BtnKind.Secondary, small = true)
        }
    }
    Spacer(Modifier.weight(1f))
    MsButton("Listo", onDone, Modifier.fillMaxWidth().navigationBarsPadding().padding(16.dp), kind = BtnKind.Accent, icon = Ic.Check)
}
