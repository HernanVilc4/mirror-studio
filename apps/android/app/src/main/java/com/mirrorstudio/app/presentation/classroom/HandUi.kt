package com.mirrorstudio.app.presentation.classroom

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import com.mirrorstudio.app.domain.ChatMessage
import com.mirrorstudio.app.domain.MeetingSnapshot
import com.mirrorstudio.app.domain.Member
import com.mirrorstudio.app.domain.MessageBody
import com.mirrorstudio.app.presentation.motion.reducedMotion
import com.mirrorstudio.app.presentation.theme.Ms
import com.mirrorstudio.app.presentation.ui.Avatar
import com.mirrorstudio.app.presentation.ui.BtnKind
import com.mirrorstudio.app.presentation.ui.Card
import com.mirrorstudio.app.presentation.ui.Chip
import com.mirrorstudio.app.presentation.ui.Ic
import com.mirrorstudio.app.presentation.ui.MsButton
import com.mirrorstudio.app.presentation.ui.MsField

/**
 * La mano sube 12 dp y se balancea dos veces (±8°) al levantarla (prototipo, «Levantar la mano»).
 */
@Composable
fun WavingHand(up: Boolean, size: Int = 28) {
    val reduced = reducedMotion()
    val lift = remember { Animatable(0f) }
    val tilt = remember { Animatable(0f) }
    LaunchedEffect(up) {
        if (!up || reduced) { lift.snapTo(0f); tilt.snapTo(0f); return@LaunchedEffect }
        lift.animateTo(-12f, tween(160))
        repeat(2) { tilt.animateTo(8f, tween(70)); tilt.animateTo(-8f, tween(70)) }
        tilt.animateTo(0f, tween(60))
        lift.animateTo(0f, tween(140))
    }
    Icon(
        Ic.Hand, null, tint = Ms.Warn,
        modifier = Modifier.size(size.dp).graphicsLayer { translationY = lift.value * density; rotationZ = tilt.value }
    )
}

/** Pantalla 21: tarjeta amarilla del alumno con la mano levantada y la pregunta opcional. */
@Composable
fun HandCard(m: MeetingSnapshot, savedText: String?, onSend: (String) -> Unit, onLower: () -> Unit) {
    val pos = m.myself?.hand ?: return
    var text by rememberSaveable { mutableStateOf(savedText.orEmpty()) }
    Column(
        Modifier.fillMaxWidth().background(Ms.WarnSoft, RoundedCornerShape(16.dp)).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            WavingHand(true)
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text("Levantaste la mano", style = MaterialTheme.typography.titleSmall, color = Ms.Warn)
                Text(
                    "Eres el $pos.º en la fila. El docente te verá y podrá ayudarte desde su PC o su teléfono.",
                    style = MaterialTheme.typography.bodySmall, color = Ms.Warn
                )
            }
        }
        MsField(
            "Añade una pregunta (opcional)", text, { text = it.take(200) },
            placeholder = "Escribe tu duda…", caps = KeyboardCapitalization.Sentences,
            imeAction = ImeAction.Send, onIme = { if (text.isNotBlank()) onSend(text) },
            hint = if (savedText != null && savedText == text) "Enviada solo a los docentes" else null
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (text.isNotBlank() && text != savedText) MsButton("Enviar pregunta", { onSend(text) }, small = true, icon = Ic.Send)
            MsButton("Bajar la mano", onLower, kind = BtnKind.Secondary, small = true)
        }
    }
}

/** Pantalla 22: fila de manos para los docentes. «Ayudar» pide el control de su PC. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HandsSheet(
    m: MeetingSnapshot,
    questions: List<ChatMessage>,
    onHelp: (Member) -> Unit,
    onLower: (Member) -> Unit,
    onDismiss: () -> Unit
) {
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = Ms.Bg) {
        Column(Modifier.padding(horizontal = 20.dp)) {
            Text("${m.name} · ${m.hands.size} en la fila", style = MaterialTheme.typography.labelMedium, color = Ms.Muted)
            Text("Manos levantadas", style = MaterialTheme.typography.titleLarge)
        }
        LazyColumn(Modifier.navigationBarsPadding(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (m.hands.isEmpty()) item {
                Text("Nadie tiene la mano levantada.", style = MaterialTheme.typography.bodyMedium, color = Ms.Muted, modifier = Modifier.padding(8.dp))
            }
            items(m.hands, key = { it.id }) { p ->
                val q = questions.lastOrNull { it.from == p.id && it.body is MessageBody.Question }
                Card(Modifier.fillMaxWidth().animateItem(), padding = PaddingValues(12.dp)) {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Box(Modifier.size(28.dp).background(Ms.WarnSoft, CircleShape), contentAlignment = Alignment.Center) {
                                Text("${p.hand}", style = MaterialTheme.typography.labelMedium, color = Ms.Warn)
                            }
                            Spacer(Modifier.width(10.dp))
                            Avatar(p.name, size = 32.dp)
                            Spacer(Modifier.width(10.dp))
                            Column(Modifier.weight(1f)) {
                                Text(p.name, style = MaterialTheme.typography.titleSmall)
                                q?.let { Text(ago(it.at), style = MaterialTheme.typography.bodySmall, color = Ms.Muted) }
                            }
                            if (p.device.name == "PHONE") Chip("Teléfono", bg = Ms.Hover, fg = Ms.Muted)
                        }
                        q?.let { Text("«${(it.body as MessageBody.Question).text}»", style = MaterialTheme.typography.bodyMedium) }
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            if (p.device.name == "PC") MsButton("Ayudar", { onHelp(p) }, small = true, icon = Ic.Pointer)
                            MsButton("Bajar", { onLower(p) }, kind = BtnKind.Secondary, small = true)
                        }
                    }
                }
            }
            item { Text("«Ayudar» pide el control de su PC. Al aceptar, su mano baja sola.", style = MaterialTheme.typography.bodySmall, color = Ms.Muted) }
        }
    }
}

fun ago(at: Long): String {
    val s = ((System.currentTimeMillis() - at) / 1000).coerceAtLeast(0)
    return when {
        s < 60 -> "hace ${s} s"
        s < 3600 -> "hace ${s / 60} min"
        else -> "hace ${s / 3600} h"
    }
}
