package com.mirrorstudio.app.presentation.classroom

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.mirrorstudio.app.domain.MeetingLink
import com.mirrorstudio.app.domain.MessageBody
import com.mirrorstudio.app.presentation.ScreenTransition
import com.mirrorstudio.app.presentation.room.RoomBarSlots
import com.mirrorstudio.app.presentation.room.RoomScreen
import com.mirrorstudio.app.presentation.room.RoomViewModel
import com.mirrorstudio.app.presentation.scan.ScanScreen
import com.mirrorstudio.app.presentation.theme.Ms
import com.mirrorstudio.app.presentation.ui.BtnKind
import com.mirrorstudio.app.presentation.ui.Card
import com.mirrorstudio.app.presentation.ui.Ic
import com.mirrorstudio.app.presentation.ui.MsButton

/** Pantallas que se abren encima de la sala. */
private enum class Over { NONE, MESSAGES, PAIR_INTRO, PAIR_SCAN, PAIRED, SLIDES }

/**
 * La sala con las funciones de aula (v5): mano, mensajes, encuestas, vincular, diapositivas, laser y trazos.
 */
@Composable
fun RoomHost(room: RoomViewModel, vm: ClassroomViewModel) {
    val c by vm.classroom.collectAsStateWithLifecycle()
    val m by vm.meeting.collectAsStateWithLifecycle()
    val presentation by room.presentation.collectAsStateWithLifecycle()
    val meeting = m ?: return
    var over by rememberSaveable { mutableStateOf(Over.NONE) }
    var handsSheet by rememberSaveable { mutableStateOf(false) }
    var openPoll by rememberSaveable { mutableStateOf<String?>(null) }
    var newPoll by rememberSaveable { mutableStateOf(false) }
    val staff = meeting.myself?.role?.isStaff == true
    val me = meeting.myself
    val pc = meeting.pairedPc
    val tick = com.mirrorstudio.app.presentation.motion.rememberTick()

    // Al quedar vinculado (pair-claim aceptado) se muestra la pantalla 16.
    var wasPaired by rememberSaveable { mutableStateOf(pc != null) }
    LaunchedEffect(pc?.id) {
        if (pc != null && !wasPaired && (over == Over.PAIR_SCAN || over == Over.PAIR_INTRO)) over = Over.PAIRED
        wasPaired = pc != null
    }
    // Una encuesta nueva se abre sola para los alumnos.
    LaunchedEffect(c.polls.keys) {
        if (!staff) c.polls.values.firstOrNull { !it.closed && it.myChoices.isEmpty() && it.id != openPoll }?.let { if (openPoll == null) openPoll = it.id }
    }

    val bar = RoomBarSlots(
        messages = { over = Over.MESSAGES },
        unread = c.unread,
        hand = if (staff) ({ handsSheet = true }) else ({ tick(); if (me?.hand != null) vm.lowerHand() else vm.raiseHand(null) }),
        handUp = if (staff) meeting.hands.isNotEmpty() else me?.hand != null
    )

    ScreenTransition(over, forward = over != Over.NONE) { o ->
        when (o) {
            Over.NONE -> RoomScreen(room, extraBar = bar, extraPanels = {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    HandCard(meeting, c.handText, onSend = { vm.raiseHand(it) }, onLower = vm::lowerHand)
                    if (staff && meeting.hands.isNotEmpty()) HandsSummary(meeting.hands.size) { handsSheet = true }
                    PairCard(pc?.name, onPair = { over = Over.PAIR_INTRO }, onSlides = { over = Over.SLIDES }, onUnpair = vm::unpair)
                }
            })
            Over.MESSAGES -> MessagesScreen(vm, meeting, c, onClose = { over = Over.NONE }, onOpenPoll = { openPoll = it }, onNewPoll = { newPoll = true })
            Over.PAIR_INTRO -> PairIntroScreen(onBack = { over = Over.NONE }, onScan = { over = Over.PAIR_SCAN })
            Over.PAIR_SCAN -> ScanScreen(
                onBack = { over = Over.PAIR_INTRO },
                onManual = { over = Over.PAIR_INTRO },
                onLink = { link -> if (link.kind == MeetingLink.Kind.PAIR) vm.pair(link.token!!) else over = Over.PAIR_INTRO },
                title = "Escanear QR de vinculación",
                hint = "Apunta al QR de «Vincular mi teléfono» que muestra tu PC. Solo lo ves tú."
            )
            Over.PAIRED -> pc?.let { PairedScreen(it, onOpenSlides = { over = Over.SLIDES }, onClose = { over = Over.NONE }) } ?: LaunchedEffect(Unit) { over = Over.NONE }
            Over.SLIDES -> pc?.let {
                SlidesScreen(
                    vm, it, presenting = meeting.presenter?.id == it.id, track = presentation, egl = room.egl, unread = c.unread,
                    onMessages = { over = Over.MESSAGES }, onClose = { over = Over.NONE }
                )
            } ?: LaunchedEffect(Unit) { over = Over.NONE }
        }
    }

    if (handsSheet) HandsSheet(
        meeting, c.messages.filter { it.body is MessageBody.Question },
        onHelp = { handsSheet = false; room.requestControl(it.id) }, onLower = { vm.lowerHandOf(it.id) }, onDismiss = { handsSheet = false }
    )
    openPoll?.let { id ->
        c.polls[id]?.let { p ->
            val author = c.messages.firstOrNull { (it.body as? MessageBody.Poll)?.pollId == id }?.fromName
            PollSheet(p, author, staff, onVote = { vm.vote(id, it) }, onClose = { vm.closePoll(id) }, onDismiss = { openPoll = null })
        }
    }
    if (newPoll) NewPollSheet(onDismiss = { newPoll = false }) { q, o, multi, anon, onClose -> vm.createPoll(q, o, multi, anon, onClose) }
}

@Composable
private fun HandsSummary(count: Int, onOpen: () -> Unit) {
    Card(Modifier.fillMaxWidth(), onClick = onOpen) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            WavingHand(true, 24)
            Spacer(Modifier.width(10.dp))
            Text(if (count == 1) "1 mano levantada" else "$count manos levantadas", style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
            Icon(Ic.Next, null, tint = Ms.Muted, modifier = Modifier.size(20.dp))
        }
    }
}

/** «Controla tu PC desde aquí»: vincular el telefono con la PC propia (seccion 3). */
@Composable
private fun PairCard(pcName: String?, onPair: () -> Unit, onSlides: () -> Unit, onUnpair: () -> Unit) {
    Card(Modifier.fillMaxWidth()) {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Ic.Phone, null, tint = Ms.Accent, modifier = Modifier.size(20.dp))
                Spacer(Modifier.width(8.dp))
                Text(if (pcName != null) "Vinculado con $pcName" else "Controla tu PC desde aquí", style = MaterialTheme.typography.titleSmall)
            }
            if (pcName == null) {
                Text("Vincula tu PC para pasar diapositivas, usar el láser y anotar.", style = MaterialTheme.typography.bodySmall, color = Ms.Muted)
                MsButton("Vincular mi PC", onPair, Modifier.fillMaxWidth(), icon = Ic.Phone)
            } else {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    MsButton("Diapositivas", onSlides, Modifier.weight(1f), icon = Ic.Play)
                    MsButton("Desvincular", onUnpair, kind = BtnKind.Ghost)
                }
            }
        }
    }
}
