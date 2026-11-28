package com.mirrorstudio.app.presentation

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.mirrorstudio.app.domain.MeetingLink
import com.mirrorstudio.app.domain.MeetingRepository
import com.mirrorstudio.app.domain.SessionStatus
import com.mirrorstudio.app.presentation.brand.BrandAnchor
import com.mirrorstudio.app.presentation.brand.BrandIntro
import com.mirrorstudio.app.presentation.brand.LocalBrandAnchor
import com.mirrorstudio.app.presentation.ended.EndedScreen
import com.mirrorstudio.app.presentation.home.HomeScreen
import com.mirrorstudio.app.presentation.join.JoinScreen
import com.mirrorstudio.app.presentation.join.JoinViewModel
import com.mirrorstudio.app.presentation.link.LinkScreen
import com.mirrorstudio.app.presentation.classroom.ClassroomViewModel
import com.mirrorstudio.app.presentation.classroom.RoomHost
import com.mirrorstudio.app.presentation.scan.ScanScreen
import com.mirrorstudio.app.presentation.theme.MirrorStudioTheme
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import org.koin.androidx.compose.koinViewModel
import org.koin.compose.koinInject
import org.koin.core.parameter.parametersOf

/** Pantallas antes de entrar a una reunion. */
sealed interface Dest {
    data object Home : Dest
    data class JoinIp(val ip: String? = null, val port: Int? = null) : Dest
    data object Scan : Dest
    data class Link(val link: MeetingLink) : Dest
}

/** Que se ve: la reunion manda (sala o fin); si no hay reunion, la pila de pantallas de entrada. */
private sealed interface Top {
    data class Pre(val dest: Dest) : Top
    data object Room : Top
    data class Ended(val s: SessionStatus.Ended) : Top
}

@Composable
fun MirrorStudioRoot(
    incomingLinks: StateFlow<MeetingLink?>,
    consumeLink: () -> Unit,
    repository: MeetingRepository = koinInject()
) {
    val status by repository.status.collectAsStateWithLifecycle()
    val nav = remember { Navigator<Dest>(Dest.Home) }
    val anchor = remember { BrandAnchor() }
    var introDone by rememberSaveable { mutableStateOf(false) }
    if (introDone) anchor.playing = false
    val scope = rememberCoroutineScope()

    // Un enlace mirrorstudio:// que abrio la app (o llego con la app abierta).
    val classroom: ClassroomViewModel = koinViewModel()
    val link by incomingLinks.collectAsStateWithLifecycle()
    LaunchedEffect(link) {
        val l = link ?: return@LaunchedEffect
        consumeLink()
        // Un QR de vincular abierto desde la camara del telefono, ya dentro de la reunion.
        if (status is SessionStatus.InMeeting && l.kind == MeetingLink.Kind.PAIR) { classroom.pair(l.token!!); return@LaunchedEffect }
        if (status !is SessionStatus.InMeeting && status !is SessionStatus.Reconnecting) {
            if (nav.top is Dest.Link) nav.replace(Dest.Link(l)) else nav.push(Dest.Link(l))
        }
    }

    val top: Top = when (val s = status) {
        is SessionStatus.InMeeting, is SessionStatus.Reconnecting -> Top.Room
        is SessionStatus.Ended -> Top.Ended(s)
        else -> Top.Pre(nav.top)
    }
    // Al entrar a la sala, la pila de entrada vuelve a Inicio para cuando se salga.
    LaunchedEffect(top is Top.Room) { if (top is Top.Room && nav.canPop) nav.reset(Dest.Home) }

    BackHandler(enabled = top is Top.Pre && nav.canPop) { nav.pop() }

    MirrorStudioTheme {
        CompositionLocalProvider(LocalBrandAnchor provides anchor) {
            Box(Modifier.fillMaxSize()) {
                ScreenTransition(top, forward = top !is Top.Pre || nav.forward, key = { t -> if (t is Top.Pre) t.dest else t::class }) { t ->
                    when (t) {
                        is Top.Room -> RoomHost(koinViewModel(), classroom)
                        is Top.Ended -> EndedScreen(
                            t.s.kind, t.s.reason, t.s.canRetry,
                            onHome = { repository.acknowledgeEnded() },
                            onRetry = { scope.launch { repository.acknowledgeEnded(); repository.rejoin() } }
                        )
                        is Top.Pre -> when (val d = t.dest) {
                            Dest.Home -> HomeScreen(
                                koinViewModel(),
                                onScan = { nav.push(Dest.Scan) },
                                onJoinIp = { ip, port -> nav.push(Dest.JoinIp(ip, port)) }
                            )
                            is Dest.JoinIp -> {
                                val vm: JoinViewModel = koinViewModel(key = "join")
                                LaunchedEffect(d) { vm.prefill(d.ip, d.port) }
                                JoinScreen(vm, onBack = { nav.pop() })
                            }
                            Dest.Scan -> ScanScreen(
                                onBack = { nav.pop() },
                                onManual = { nav.replace(Dest.JoinIp()) },
                                onLink = { nav.replace(Dest.Link(it)) }
                            )
                            is Dest.Link -> LinkScreen(
                                koinViewModel(key = d.link.toString()) { parametersOf(d.link) }, d.link,
                                onCancel = { nav.pop() }
                            )
                        }
                    }
                }
                if (!introDone) BrandIntro(anchor) { introDone = true }
            }
        }
    }
}
