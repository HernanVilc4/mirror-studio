package com.mirrorstudio.app.presentation.classroom

import android.content.ClipData
import android.content.Intent
import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.slideInVertically
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.platform.ClipEntry
import com.mirrorstudio.app.domain.Allow
import com.mirrorstudio.app.domain.Audience
import com.mirrorstudio.app.domain.ChatMessage
import com.mirrorstudio.app.domain.Classroom
import com.mirrorstudio.app.domain.MeetingSnapshot
import com.mirrorstudio.app.domain.MessageBody
import com.mirrorstudio.app.domain.RoomSettings
import com.mirrorstudio.app.domain.SharedFile
import com.mirrorstudio.app.presentation.motion.Motion
import com.mirrorstudio.app.presentation.theme.Inter
import com.mirrorstudio.app.presentation.theme.Ms
import com.mirrorstudio.app.presentation.ui.BtnKind
import com.mirrorstudio.app.presentation.ui.Callout
import com.mirrorstudio.app.presentation.ui.Chip
import com.mirrorstudio.app.presentation.ui.Ic
import com.mirrorstudio.app.presentation.ui.MsButton
import com.mirrorstudio.app.presentation.ui.MsField
import com.mirrorstudio.app.presentation.ui.RoundButton
import com.mirrorstudio.app.presentation.ui.Tone
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private enum class Tab(val label: String) { ALL("Todos"), QUESTIONS("Preguntas"), FILES("Archivos") }

/** Pantallas 23, 29 y 30: el chat de grupo de la sala, como el de Meet. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MessagesScreen(
    vm: ClassroomViewModel,
    m: MeetingSnapshot,
    c: Classroom,
    onClose: () -> Unit,
    onOpenPoll: (String) -> Unit,
    onNewPoll: () -> Unit
) {
    BackHandler(onBack = onClose)
    LaunchedEffect(c.messages.size) { vm.markRead() }
    val staff = m.myself?.role?.isStaff == true
    var tab by rememberSaveable { mutableStateOf(Tab.ALL) }
    var toTeachers by rememberSaveable { mutableStateOf(false) }
    var sendSheet by rememberSaveable { mutableStateOf(false) }
    var settingsSheet by rememberSaveable { mutableStateOf(false) }
    val canWrite = !c.chatMuted && (staff || c.settings.chat != Allow.OFF)
    val onlyTeachers = !staff && c.settings.chat == Allow.TEACHERS
    val audience = if (toTeachers || onlyTeachers) Audience.Teachers else Audience.All
    val canShare = !c.chatMuted && (staff || c.settings.share != Allow.OFF)

    val list = when (tab) {
        Tab.ALL -> c.messages
        Tab.QUESTIONS -> c.messages.filter { it.body is MessageBody.Question || (it.to == Audience.Teachers && !it.mine && staff) }
        Tab.FILES -> c.messages.filter { it.body is MessageBody.File || it.body is MessageBody.Link }
    }
    val listState = rememberLazyListState()
    LaunchedEffect(list.size) { if (list.isNotEmpty()) listState.animateScrollToItem(list.lastIndex) }

    Column(Modifier.fillMaxSize().background(Ms.Bg).imePadding()) {
        Column(Modifier.fillMaxWidth().background(Ms.Surface).statusBarsPadding().padding(start = 20.dp, end = 12.dp, top = 8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(m.name, style = MaterialTheme.typography.labelMedium, color = Ms.Muted)
                    Text("Mensajes", style = MaterialTheme.typography.titleLarge)
                }
                if (staff) { RoundButton(Ic.Sliders, "Ajustes de la sala", { settingsSheet = true }); Spacer(Modifier.width(8.dp)) }
                RoundButton(Ic.Close, "Cerrar", onClose)
            }
            Row(Modifier.padding(vertical = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Tab.entries.forEach { t -> MsButton(t.label, { tab = t }, kind = if (tab == t) BtnKind.Primary else BtnKind.Ghost, small = true) }
            }
        }
        if (c.settings.chat == Allow.OFF && !staff) Callout("El docente desactivó el chat. Aún puedes ver lo que se envió.", Modifier.padding(12.dp), tone = Tone.Warn, icon = Ic.Mute)
        if (c.chatMuted) Callout("Un docente te silenció en el chat. Puedes leer, pero no escribir.", Modifier.padding(12.dp), tone = Tone.Warn, icon = Ic.Mute)
        LazyColumn(
            Modifier.weight(1f).fillMaxWidth(), state = listState,
            contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            if (list.isEmpty()) item {
                Text(
                    when (tab) { Tab.ALL -> "Todavía no hay mensajes."; Tab.QUESTIONS -> "No hay preguntas."; Tab.FILES -> "Nadie compartió archivos ni enlaces." },
                    color = Ms.Muted, style = MaterialTheme.typography.bodyMedium
                )
            }
            items(list, key = { it.id }) { msg ->
                Bubble(
                    msg, m, c, staff,
                    onDelete = { vm.delete(msg.id) },
                    onMute = { vm.mute(msg.from, !c.mutedIds.contains(msg.from)) },
                    onAnswered = { vm.markAnswered(msg.id, !msg.answered) },
                    onShow = { vm.showToAll(msg.id, it) },
                    onPoll = onOpenPoll,
                    onDownload = vm::download,
                    modifier = Modifier.animateItem()
                )
            }
            if (staff) item { Text("Mantén pulsado un mensaje para moderarlo. Los alumnos solo pueden borrar los suyos.", style = MaterialTheme.typography.bodySmall, color = Ms.Muted) }
        }
        if (canWrite) Composer(
            toTeachers = toTeachers || onlyTeachers, lockedToTeachers = onlyTeachers,
            onToggleTo = { toTeachers = !toTeachers },
            onAttach = if (canShare || staff) ({ sendSheet = true }) else null,
            onSend = { text, question -> vm.sendText(audience, text, question) },
            staff = staff
        ) else Box(Modifier.fillMaxWidth().background(Ms.Surface).navigationBarsPadding().padding(18.dp)) {
            Text(if (c.chatMuted) "Silenciado por el docente" else "Chat desactivado por el docente", color = Ms.Muted, style = MaterialTheme.typography.bodyMedium)
        }
    }

    if (sendSheet) SendSheet(staff, canShare, onDismiss = { sendSheet = false }, onLink = { url, title -> vm.sendLink(audience, url, title) },
        onFile = { vm.sendFile(audience, it) }, onPoll = { sendSheet = false; onNewPoll() })
    if (settingsSheet) SettingsSheet(c.settings, c.mutedIds.map { it to m.nameOf(it) }, onChange = vm::setSettings, onUnmute = { vm.mute(it, false) }, onDismiss = { settingsSheet = false })
}

private val clock = SimpleDateFormat("HH:mm", Locale.getDefault())

/** Burbuja: sube 8 dp y aparece al llegar; al borrarla se convierte en el contorno punteado. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun Bubble(
    msg: ChatMessage, m: MeetingSnapshot, c: Classroom, staff: Boolean,
    onDelete: () -> Unit, onMute: () -> Unit, onAnswered: () -> Unit, onShow: (Boolean) -> Unit,
    onPoll: (String) -> Unit, onDownload: (String) -> Unit, modifier: Modifier
) {
    var menu by remember { mutableStateOf(false) }
    var appeared by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { appeared = true }
    val clipboard = LocalClipboard.current
    val scope = androidx.compose.runtime.rememberCoroutineScope()
    AnimatedVisibility(appeared, modifier, enter = fadeIn(tween(180)) + slideInVertically(tween(180, easing = Motion.Ease)) { 8 * 3 }) {
        Column(Modifier.fillMaxWidth(), horizontalAlignment = if (msg.mine) Alignment.End else Alignment.Start) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(if (msg.mine) "Tú" else msg.fromName, style = MaterialTheme.typography.labelMedium)
                msg.fromRole?.takeIf { it.isStaff }?.let { Spacer(Modifier.width(6.dp)); Chip(it.label) }
                Spacer(Modifier.width(6.dp))
                Text(clock.format(Date(msg.at)), style = MaterialTheme.typography.labelSmall, color = Ms.Muted)
            }
            Spacer(Modifier.height(4.dp))
            Box {
                if (msg.deleted) {
                    Text(
                        "Mensaje eliminado por el docente", style = MaterialTheme.typography.bodyMedium, color = Ms.Muted,
                        modifier = Modifier.animateContentSize().drawBehind {
                            drawRoundRect(Ms.Line, style = Stroke(2f, pathEffect = PathEffect.dashPathEffect(floatArrayOf(10f, 8f))), cornerRadius = androidx.compose.ui.geometry.CornerRadius(16.dp.toPx()))
                        }.padding(horizontal = 14.dp, vertical = 10.dp)
                    )
                } else {
                    val bg = when { msg.mine -> Ms.Accent; msg.body is MessageBody.Question -> Ms.WarnSoft; else -> Ms.Surface }
                    val fg = if (msg.mine) Color.White else Ms.Fg
                    Column(
                        Modifier.widthIn(max = 300.dp).animateContentSize()
                            .background(bg, RoundedCornerShape(16.dp))
                            .then(if (msg.mine) Modifier else Modifier.border(1.dp, Ms.Line, RoundedCornerShape(16.dp)))
                            .combinedClickable(onClick = {}, onLongClick = { menu = true })
                            .padding(horizontal = 14.dp, vertical = 10.dp)
                    ) {
                        BubbleBody(msg, fg, c, onPoll, onDownload)
                    }
                }
                DropdownMenu(menu, { menu = false }, containerColor = Ms.Surface) {
                    val text = (msg.body as? MessageBody.Text)?.text ?: (msg.body as? MessageBody.Question)?.text ?: (msg.body as? MessageBody.Link)?.url
                    if (text != null) DropdownMenuItem({ Text("Copiar") }, {
                        menu = false
                        scope.launch { clipboard.setClipEntry(ClipEntry(ClipData.newPlainText("mensaje", text))) }
                    })
                    if (staff && msg.body is MessageBody.Question) {
                        DropdownMenuItem({ Text(if (msg.answered) "Marcar sin responder" else "Marcar respondida") }, { menu = false; onAnswered() })
                        DropdownMenuItem({ Text("Mostrar a todos") }, { menu = false; onShow(false) })
                        DropdownMenuItem({ Text("Mostrar a todos sin nombre") }, { menu = false; onShow(true) })
                    }
                    if (!msg.deleted && (msg.mine || staff)) DropdownMenuItem({ Text(if (msg.mine) "Borrar" else "Borrar para todos", color = Ms.Danger) }, { menu = false; onDelete() })
                    if (staff && !msg.mine) DropdownMenuItem(
                        { Text(if (c.mutedIds.contains(msg.from)) "Quitar silencio a ${msg.fromName}" else "Silenciar a ${msg.fromName}") },
                        { menu = false; onMute() }
                    )
                }
            }
            val note = when {
                msg.to == Audience.Teachers && msg.mine -> "Privado · solo lo ven los docentes"
                msg.to == Audience.Teachers -> "Privado · para docentes"
                msg.to is Audience.People -> "Privado"
                msg.shown -> "Mostrada a todos"
                msg.answered -> "Respondida"
                else -> null
            }
            note?.let { Text(it, style = MaterialTheme.typography.labelSmall, color = Ms.Muted, modifier = Modifier.padding(top = 4.dp)) }
        }
    }
}

@Composable
private fun BubbleBody(msg: ChatMessage, fg: Color, c: Classroom, onPoll: (String) -> Unit, onDownload: (String) -> Unit) {
    val context = LocalContext.current
    when (val b = msg.body) {
        is MessageBody.Text -> Text(b.text, color = fg, style = MaterialTheme.typography.bodyMedium)
        is MessageBody.Question -> Column {
            Text("Pregunta", style = MaterialTheme.typography.labelSmall, color = if (msg.mine) fg else Ms.Warn)
            Text(b.text, color = fg, style = MaterialTheme.typography.bodyMedium)
        }
        is MessageBody.Link -> {
            val host = runCatching { Uri.parse(b.url).host }.getOrNull() ?: b.url
            // Nunca se abre solo: se muestra el dominio y se abre solo al tocar «Abrir».
            Column {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Ic.Link, null, tint = fg, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(6.dp))
                    Text(b.title ?: host, color = fg, style = MaterialTheme.typography.titleSmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
                Text(host, color = fg.copy(alpha = 0.75f), style = MaterialTheme.typography.bodySmall)
                Spacer(Modifier.height(6.dp))
                MsButton("Abrir", { runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(b.url))) } }, kind = BtnKind.Secondary, small = true)
            }
        }
        is MessageBody.File -> FileBody(c.files[b.fileId], fg, b.fileId, onDownload)
        is MessageBody.Poll -> {
            val p = c.polls[b.pollId]
            Column {
                Text("Encuesta · ${if (p?.closed == true) "cerrada" else "abierta"}", style = MaterialTheme.typography.labelSmall, color = fg.copy(alpha = 0.75f))
                Text(p?.question ?: "Encuesta", color = fg, style = MaterialTheme.typography.titleSmall)
                Spacer(Modifier.height(6.dp))
                MsButton(
                    when { p == null -> "Ver"; p.mine -> "Ver resultados"; p.closed -> "Ver resultados"; p.myChoices.isNotEmpty() -> "Cambiar respuesta"; else -> "Responder" },
                    { onPoll(b.pollId) }, kind = BtnKind.Secondary, small = true
                )
            }
        }
    }
}

@Composable
private fun FileBody(f: SharedFile?, fg: Color, id: String, onDownload: (String) -> Unit) {
    val context = LocalContext.current
    Column {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(Ic.File, null, tint = fg, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp))
            Column {
                Text(f?.name ?: "Archivo", color = fg, style = MaterialTheme.typography.titleSmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
                f?.let { Text(humanSize(it.size), color = fg.copy(alpha = 0.75f), style = MaterialTheme.typography.bodySmall) }
            }
        }
        Spacer(Modifier.height(6.dp))
        when {
            f?.progress != null -> LinearProgressIndicator({ f.progress }, Modifier.width(180.dp), color = Ms.Accent, trackColor = Ms.Hover)
            f?.error != null -> Text(f.error, color = Ms.Danger, style = MaterialTheme.typography.bodySmall)
            f?.savedTo != null -> MsButton("Abrir", {
                runCatching {
                    context.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(f.savedTo, f.mime ?: "*/*").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
                }
            }, kind = BtnKind.Secondary, small = true, icon = Ic.File)
            else -> MsButton("Descargar", { onDownload(id) }, kind = BtnKind.Secondary, small = true, icon = Ic.Download)
        }
    }
}

fun humanSize(b: Long): String = when {
    b < 1024 -> "$b B"
    b < 1024 * 1024 -> "${b / 1024} KB"
    else -> String.format(Locale.getDefault(), "%.1f MB", b / 1048576.0)
}

@Composable
private fun Composer(
    toTeachers: Boolean, lockedToTeachers: Boolean, staff: Boolean,
    onToggleTo: () -> Unit, onAttach: (() -> Unit)?, onSend: (String, Boolean) -> Unit
) {
    var text by rememberSaveable { mutableStateOf("") }
    var question by rememberSaveable { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().background(Ms.Surface).navigationBarsPadding().padding(horizontal = 12.dp, vertical = 8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            MsButton(
                "Para: " + if (toTeachers) "Docentes" else "Todos", { if (!lockedToTeachers) onToggleTo() },
                kind = if (toTeachers) BtnKind.Accent else BtnKind.Ghost, small = true
            )
            if (!staff) {
                Spacer(Modifier.width(8.dp))
                MsButton("Es una pregunta", { question = !question }, kind = if (question) BtnKind.Accent else BtnKind.Ghost, small = true, icon = Ic.Question)
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            onAttach?.let { RoundButton(Ic.Plus, "Enviar archivo, enlace o encuesta", it, bordered = false); Spacer(Modifier.width(4.dp)) }
            Box(Modifier.weight(1f).background(Ms.Bg, RoundedCornerShape(22.dp)).padding(horizontal = 16.dp, vertical = 12.dp)) {
                if (text.isEmpty()) Text("Escribe un mensaje…", color = Ms.Muted.copy(alpha = 0.6f), style = MaterialTheme.typography.bodyLarge)
                BasicTextField(
                    text, { text = it.take(1000) },
                    textStyle = TextStyle(fontFamily = Inter, fontSize = 16.sp, color = Ms.Fg),
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
                    maxLines = 5, modifier = Modifier.fillMaxWidth()
                )
            }
            Spacer(Modifier.width(6.dp))
            RoundButton(
                Ic.Send, "Enviar", { if (text.isNotBlank()) { onSend(text, question); text = ""; question = false } },
                bg = if (text.isBlank()) Ms.Hover else Ms.Accent, fg = if (text.isBlank()) Ms.Muted else Color.White, bordered = false
            )
        }
    }
}

/** Pantalla 24: enviar un enlace, un archivo, una foto o (docentes) una encuesta. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SendSheet(staff: Boolean, canShare: Boolean, onDismiss: () -> Unit, onLink: (String, String?) -> Unit, onFile: (Uri) -> Unit, onPoll: () -> Unit) {
    var url by rememberSaveable { mutableStateOf("") }
    var title by rememberSaveable { mutableStateOf("") }
    val pickFile = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { it?.let { u -> onFile(u); onDismiss() } }
    val pickPhoto = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { it?.let { u -> onFile(u); onDismiss() } }
    val validUrl = url.startsWith("http://") || url.startsWith("https://")
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = Ms.Bg) {
        Column(Modifier.navigationBarsPadding().verticalScroll(androidx.compose.foundation.rememberScrollState()).padding(horizontal = 20.dp).padding(bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Enviar a la sala", style = MaterialTheme.typography.titleLarge)
            if (canShare) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    MsButton("Archivo", { pickFile.launch(arrayOf("*/*")) }, Modifier.weight(1f), kind = BtnKind.Secondary, icon = Ic.File)
                    MsButton("Foto", { pickPhoto.launch(androidx.activity.result.PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }, Modifier.weight(1f), kind = BtnKind.Secondary, icon = Ic.Camera)
                }
                MsField("Enlace", url, { url = it.trim() }, placeholder = "https://…", keyboard = KeyboardType.Uri,
                    error = if (url.isNotEmpty() && !validUrl) "Solo enlaces http:// o https://" else null)
                MsField("Título (opcional)", title, { title = it.take(120) })
                MsButton("Enviar enlace", { onLink(url, title); onDismiss() }, Modifier.fillMaxWidth(), icon = Ic.Link, enabled = validUrl)
            }
            if (staff) MsButton("Nueva encuesta", onPoll, Modifier.fillMaxWidth(), kind = BtnKind.Secondary, icon = Ic.Poll)
            Text("Nadie abre nada sin tocarlo. Archivos hasta 50 MB; los programas (.exe, .bat…) no se envían.", style = MaterialTheme.typography.bodySmall, color = Ms.Muted)
        }
    }
}

/** Pantalla 28: ajustes de la sala, solo docentes. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SettingsSheet(
    s: RoomSettings, muted: List<Pair<String, String>>,
    onChange: (RoomSettings) -> Unit, onUnmute: (String) -> Unit, onDismiss: () -> Unit
) {
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = Ms.Bg) {
        Column(Modifier.navigationBarsPadding().padding(horizontal = 20.dp).padding(bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Text("Solo docentes", style = MaterialTheme.typography.labelMedium, color = Ms.Muted)
            Text("Ajustes de la sala", style = MaterialTheme.typography.titleLarge)
            AllowRow("Chat", "Quién puede escribir mensajes.", s.chat) { onChange(s.copy(chat = it)) }
            AllowRow("Archivos y enlaces", "Quién puede enviarlos.", s.share) { onChange(s.copy(share = it)) }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Bloquear la sala", style = MaterialTheme.typography.titleSmall)
                    Text("Nadie más puede entrar con el enlace", style = MaterialTheme.typography.bodySmall, color = Ms.Muted)
                }
                Switch(s.locked, { onChange(s.copy(locked = it)) }, colors = SwitchDefaults.colors(checkedTrackColor = Ms.Accent))
            }
            if (muted.isNotEmpty()) {
                Text("Silenciados en el chat", style = MaterialTheme.typography.titleSmall)
                muted.forEach { (id, name) ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(name, Modifier.weight(1f))
                        MsButton("Quitar silencio", { onUnmute(id) }, kind = BtnKind.Secondary, small = true)
                    }
                }
            }
            Text("Los cambios los ve toda la sala al instante.", style = MaterialTheme.typography.bodySmall, color = Ms.Muted)
            MsButton("Listo", onDismiss, Modifier.fillMaxWidth())
        }
    }
}

@Composable
private fun AllowRow(title: String, sub: String, value: Allow, onPick: (Allow) -> Unit) {
    Column {
        Text(title, style = MaterialTheme.typography.titleSmall)
        Text(sub, style = MaterialTheme.typography.bodySmall, color = Ms.Muted)
        Spacer(Modifier.height(6.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            listOf(Allow.ALL to "Todos", Allow.TEACHERS to "Solo docentes", Allow.OFF to "Apagado").forEach { (a, label) ->
                MsButton(label, { onPick(a) }, Modifier.weight(1f), kind = if (value == a) BtnKind.Primary else BtnKind.Secondary, small = true)
            }
        }
    }
}
