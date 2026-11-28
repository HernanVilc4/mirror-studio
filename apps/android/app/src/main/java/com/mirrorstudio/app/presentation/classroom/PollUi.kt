package com.mirrorstudio.app.presentation.classroom

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import com.mirrorstudio.app.domain.Poll
import com.mirrorstudio.app.presentation.motion.Motion
import com.mirrorstudio.app.presentation.motion.rememberTick
import com.mirrorstudio.app.presentation.theme.Ms
import com.mirrorstudio.app.presentation.ui.BtnKind
import com.mirrorstudio.app.presentation.ui.Ic
import com.mirrorstudio.app.presentation.ui.MsButton
import com.mirrorstudio.app.presentation.ui.MsField
import com.mirrorstudio.app.presentation.ui.RoundButton
import kotlinx.coroutines.delay

/** Pantalla 25: nueva encuesta (docentes). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NewPollSheet(onDismiss: () -> Unit, onCreate: (String, List<String>, Boolean, Boolean, Boolean) -> Unit) {
    var question by rememberSaveable { mutableStateOf("") }
    val options = remember { mutableStateListOf("", "") }
    var anonymous by rememberSaveable { mutableStateOf(true) }
    var multi by rememberSaveable { mutableStateOf(false) }
    var onClose by rememberSaveable { mutableStateOf(false) }
    val ready = question.isNotBlank() && options.count { it.isNotBlank() } >= 2
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = Ms.Bg) {
        Column(
            Modifier.navigationBarsPadding().imePadding().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).padding(bottom = 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Text("Para toda la sala", style = MaterialTheme.typography.labelMedium, color = Ms.Muted)
            Text("Nueva encuesta", style = MaterialTheme.typography.titleLarge)
            MsField("Pregunta", question, { question = it.take(300) }, singleLine = false)
            Text("Opciones", style = MaterialTheme.typography.labelMedium, color = Ms.Muted)
            options.forEachIndexed { i, o ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    MsField("Opción ${i + 1}", o, { options[i] = it.take(100) }, Modifier.weight(1f))
                    if (options.size > 2) RoundButton(Ic.Close, "Quitar opción", { options.removeAt(i) }, Modifier.padding(start = 8.dp, top = 20.dp), size = 36.dp, bordered = false)
                }
            }
            if (options.size < 6) MsButton("Añadir opción", { options.add("") }, kind = BtnKind.Ghost, icon = Ic.Plus, small = true)
            Toggle("Anónima", "No se ve quién eligió qué", anonymous) { anonymous = it }
            Toggle("Varias respuestas", null, multi) { multi = it }
            Toggle("Mostrar resultados al cerrar", "Mientras, solo tú los ves", onClose) { onClose = it }
            MsButton("Lanzar encuesta", { onCreate(question, options.toList(), multi, anonymous, onClose); onDismiss() }, Modifier.fillMaxWidth(), icon = Ic.Poll, enabled = ready, large = true)
        }
    }
}

@Composable
private fun Toggle(title: String, sub: String?, value: Boolean, onChange: (Boolean) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleSmall)
            sub?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Ms.Muted) }
        }
        Switch(value, onChange, colors = SwitchDefaults.colors(checkedTrackColor = Ms.Accent))
    }
}

/** Pantallas 26 (responder) y 27 (resultados). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PollSheet(poll: Poll, author: String?, staff: Boolean, onVote: (List<Int>) -> Unit, onClose: () -> Unit, onDismiss: () -> Unit) {
    val showResults = poll.closed || staff || (poll.counts != null && poll.myChoices.isNotEmpty())
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = Ms.Bg) {
        Column(Modifier.navigationBarsPadding().padding(horizontal = 20.dp).padding(bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(
                if (showResults && poll.counts != null) (if (poll.closed) "Cerrada" else "En vivo") + " · ${poll.total} " + (if (poll.total == 1) "respuesta" else "respuestas")
                else author?.let { "$it · Encuesta" } ?: "Encuesta",
                style = MaterialTheme.typography.labelMedium, color = Ms.Muted
            )
            Text(poll.question, style = MaterialTheme.typography.titleLarge)
            if (showResults && poll.counts != null) {
                Results(poll)
                if (staff && !poll.closed) MsButton("Cerrar y mostrar", { onClose(); onDismiss() }, Modifier.fillMaxWidth(), large = true)
                if (!staff && !poll.closed) Answer(poll, onVote)
            } else if (poll.closed) {
                Text("La encuesta se cerró.", color = Ms.Muted)
            } else {
                Answer(poll, onVote)
                if (poll.myChoices.isNotEmpty() && poll.counts == null) Text("Los resultados se verán cuando el docente la cierre.", style = MaterialTheme.typography.bodySmall, color = Ms.Muted)
            }
        }
    }
}

/** La opcion elegida se rellena de azul; vibra al enviar. */
@Composable
private fun Answer(poll: Poll, onVote: (List<Int>) -> Unit) {
    val picked = remember(poll.id) { mutableStateListOf<Int>().apply { addAll(poll.myChoices) } }
    val tick = rememberTick()
    Text(
        (if (poll.multi) "Elige una o más respuestas." else "Elige una respuesta.") + if (poll.anonymous) " Es anónima." else " El docente verá tu nombre.",
        style = MaterialTheme.typography.bodySmall, color = Ms.Muted
    )
    poll.options.forEachIndexed { i, o ->
        val on = i in picked
        val bg by animateColorAsState(if (on) Ms.AccentSoft else Ms.Surface, tween(200), label = "opcion")
        Row(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(bg)
                .border(if (on) 2.dp else 1.dp, if (on) Ms.Accent else Ms.Line, RoundedCornerShape(14.dp))
                .clickable { if (poll.multi) { if (on) picked.remove(i) else picked.add(i) } else { picked.clear(); picked.add(i) } }
                .padding(14.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box(Modifier.size(20.dp).background(if (on) Ms.Accent else Ms.Surface, if (poll.multi) RoundedCornerShape(5.dp) else CircleShape).border(1.dp, if (on) Ms.Accent else Ms.Line, if (poll.multi) RoundedCornerShape(5.dp) else CircleShape), contentAlignment = Alignment.Center) {
                if (on) Icon(Ic.Check, null, tint = Ms.Surface, modifier = Modifier.size(14.dp))
            }
            Spacer(Modifier.width(12.dp))
            Text(o, style = MaterialTheme.typography.bodyLarge)
        }
    }
    MsButton(
        if (poll.myChoices.isEmpty()) "Enviar respuesta" else "Cambiar respuesta",
        { tick(); onVote(picked.sorted()) }, Modifier.fillMaxWidth(), enabled = picked.isNotEmpty() && picked.sorted() != poll.myChoices, large = true
    )
}

/** Las barras crecen en cascada, 60 ms entre una y otra. */
@Composable
private fun Results(poll: Poll) {
    val counts = poll.counts ?: return
    val total = counts.sum().coerceAtLeast(1)
    val best = counts.maxOrNull() ?: 0
    poll.options.forEachIndexed { i, o ->
        val c = counts.getOrElse(i) { 0 }
        val grow = remember { Animatable(0f) }
        LaunchedEffect(c, total) { delay(60L * i); grow.animateTo(c.toFloat() / total, tween(500, easing = Motion.Ease)) }
        Column {
            Row {
                Text(o, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
                Text("$c · ${c * 100 / total} %", style = MaterialTheme.typography.labelMedium, color = Ms.Muted)
            }
            Spacer(Modifier.height(4.dp))
            Box(Modifier.fillMaxWidth().height(10.dp).clip(RoundedCornerShape(50)).background(Ms.Hover)) {
                Box(Modifier.fillMaxHeight().fillMaxWidth(grow.value).background(if (c == best && c > 0) Ms.Accent else Ms.Accent.copy(alpha = 0.45f)))
            }
            if (i in poll.myChoices) Text("Tu respuesta", style = MaterialTheme.typography.labelSmall, color = Ms.Accent)
        }
    }
}
