package com.mirrorstudio.app.presentation.room

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.content.pm.ActivityInfo
import android.content.res.Configuration
import android.media.projection.MediaProjectionManager
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.mirrorstudio.app.domain.MeetingSnapshot
import com.mirrorstudio.app.domain.PresentSource
import com.mirrorstudio.app.presentation.media.VideoView
import com.mirrorstudio.app.presentation.motion.Motion
import com.mirrorstudio.app.presentation.motion.pressScale
import com.mirrorstudio.app.presentation.theme.Ms
import com.mirrorstudio.app.presentation.ui.BtnKind
import com.mirrorstudio.app.presentation.ui.Callout
import com.mirrorstudio.app.presentation.ui.Card
import com.mirrorstudio.app.presentation.ui.Ic
import com.mirrorstudio.app.presentation.ui.MsButton
import com.mirrorstudio.app.presentation.ui.RoundButton
import com.mirrorstudio.app.presentation.ui.Tone
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.webrtc.EglBase
import org.webrtc.VideoTrack

/** Que hoja o panel esta abierto encima de la sala. */
enum class RoomPanel { NONE, PEOPLE, PRESENT }

/**
 * Pantalla 05 (sala) con sus estados: 06 pantalla completa, 12 presentando, 14 reconectando y 33 sin video.
 * El control remoto (08) y la camara de documentos (20) ocupan toda la pantalla.
 */
@Composable
fun RoomScreen(viewModel: RoomViewModel, extraPanels: @Composable (RoomPanelHost) -> Unit = {}, extraBar: RoomBarSlots = RoomBarSlots()) {
    val ui by viewModel.ui.collectAsStateWithLifecycle()
    val presentation by viewModel.presentation.collectAsStateWithLifecycle()
    val controlTrack by viewModel.control.collectAsStateWithLifecycle()
    val local by viewModel.local.collectAsStateWithLifecycle()
    val m = ui.meeting ?: return
    val ex = ui.extras
    val snackbar = remember { SnackbarHostState() }
    var panel by rememberSaveable { mutableStateOf(RoomPanel.NONE) }
    var confirmLeave by rememberSaveable { mutableStateOf(false) }
    var videoHelpDismissed by rememberSaveable { mutableStateOf(false) }
    val context = LocalContext.current
    val activity = remember(context) { context.findActivity() }
    val landscape = LocalConfiguration.current.orientation == Configuration.ORIENTATION_LANDSCAPE

    LaunchedEffect(Unit) { viewModel.messages.collect { snackbar.showSnackbar(it) } }
    // Al terminar de compartir pantalla se apaga el servicio de primer plano.
    LaunchedEffect(ex.presenting) { if (ex.presenting != PresentSource.SCREEN) ScreenShareService.stop(context) }

    // Control remoto y camara de documentos: pantalla completa.
    if (ex.controlling != null) {
        ControlScreen(viewModel, m.members.firstOrNull { it.id == ex.controlling }?.name ?: "PC", controlTrack, viewModel.egl, ex.controlProblem)
        return
    }
    if (ex.presenting == PresentSource.CAMERA && local != null) {
        CameraPresentScreen(local!!, viewModel.egl, onSwitch = viewModel::switchCamera, onStop = viewModel::stopPresenting)
        return
    }
    val showRemote = presentation != null && m.presenter != null && m.presenter?.isMe != true
    if (landscape && showRemote) {
        FullscreenStage(presentation!!, viewModel.egl, m.presenterName) { activity?.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT }
        return
    }
    BackHandler { if (panel != RoomPanel.NONE) panel = RoomPanel.NONE else confirmLeave = true }

    val projection = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        val data = r.data
        if (r.resultCode == Activity.RESULT_OK && data != null) {
            ScreenShareService.start(context)
            val dm = context.resources.displayMetrics
            val scale = minOf(1f, 1280f / maxOf(dm.widthPixels, dm.heightPixels))
            // El servicio debe estar en primer plano antes de que WebRTC pida la proyeccion (Android 14).
            activity?.window?.decorView?.postDelayed({
                viewModel.presentScreen(data, (dm.widthPixels * scale).toInt() / 2 * 2, (dm.heightPixels * scale).toInt() / 2 * 2)
            }, 300)
        }
    }
    val dim by animateFloatAsState(if (ui.reconnect != null) 0.35f else 1f, tween(300), label = "atenuar")

    Box(Modifier.fillMaxSize().background(Ms.Bg)) {
        Column(Modifier.fillMaxSize()) {
            RoomHeader(m, ex.videoConnected, ui.reconnect != null, onPeople = { panel = RoomPanel.PEOPLE })
            AnimatedVisibility(
                ui.reconnect != null,
                enter = slideInVertically(tween(300, easing = Motion.Ease)) { -it } + fadeIn(),
                exit = slideOutVertically { -it } + fadeOut()
            ) { ui.reconnect?.let { ReconnectBanner(it.first, it.second) } }
            Column(
                Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp).graphicsLayer { alpha = dim },
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                Spacer(Modifier.height(4.dp))
                if (ex.presenting == PresentSource.SCREEN) PresentingBanner(viewModel::stopPresenting)
                Stage(
                    m, presentation.takeIf { showRemote }, local.takeIf { ex.presenting != null }, viewModel.egl,
                    onFullscreen = { activity?.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE }
                )
                if (showRemote) SoundRow(m.presenterName.orEmpty(), ex.muted) { viewModel.setMuted(!ex.muted) }
                AnimatedVisibility(ex.videoBlocked && !videoHelpDismissed, enter = fadeIn() + expandVertically(), exit = fadeOut() + shrinkVertically()) {
                    VideoBlocked(onRetry = { viewModel.leaveAndRejoin() }, onDismiss = { videoHelpDismissed = true })
                }
                ex.controlPending?.let { target ->
                    Callout(
                        "Esperando a que ${m.members.firstOrNull { it.id == target }?.name ?: "la PC"} acepte el control…",
                        tone = Tone.Info, icon = Ic.Pointer
                    )
                }
                extraPanels(RoomPanelHost(m, snackbar))
                ControlCard(m, onPeople = { panel = RoomPanel.PEOPLE })
                Spacer(Modifier.height(8.dp))
            }
            RoomBar(
                presenting = ex.presenting != null,
                slots = extraBar,
                onPeople = { panel = RoomPanel.PEOPLE },
                onPresent = { if (ex.presenting != null) viewModel.stopPresenting() else panel = RoomPanel.PRESENT },
                onLeave = { confirmLeave = true }
            )
        }
        SnackbarHost(snackbar, Modifier.align(Alignment.BottomCenter).padding(bottom = 96.dp))
    }

    when (panel) {
        RoomPanel.PEOPLE -> PeopleSheet(
            m, onDismiss = { panel = RoomPanel.NONE },
            onControl = { panel = RoomPanel.NONE; viewModel.requestControl(it) },
            onRole = viewModel::setRole, onKick = viewModel::kick
        )
        RoomPanel.PRESENT -> PresentSheet(
            someoneElse = m.presenter?.let { !it.isMe } == true,
            onDismiss = { panel = RoomPanel.NONE },
            onScreen = {
                panel = RoomPanel.NONE
                val mpm = context.getSystemService(MediaProjectionManager::class.java)
                projection.launch(mpm.createScreenCaptureIntent())
            },
            onCamera = { panel = RoomPanel.NONE; viewModel.presentCamera() }
        )
        RoomPanel.NONE -> Unit
    }

    if (confirmLeave) {
        AlertDialog(
            onDismissRequest = { confirmLeave = false },
            title = { Text("¿Salir de la reunión?") },
            text = { Text("Podrás volver a entrar con el mismo código mientras siga abierta.") },
            confirmButton = { TextButton(onClick = { confirmLeave = false; viewModel.leave() }) { Text("Salir", color = Ms.Danger) } },
            dismissButton = { TextButton(onClick = { confirmLeave = false }) { Text("Quedarme") } },
            containerColor = Ms.Surface
        )
    }
}

/** Para que las funciones de aula (v5) agreguen tarjetas a la sala y botones a la barra. */
class RoomPanelHost(val meeting: MeetingSnapshot, val snackbar: SnackbarHostState)

class RoomBarSlots(
    val messages: (() -> Unit)? = null,
    val unread: Int = 0,
    val hand: (() -> Unit)? = null,
    val handUp: Boolean = false
)

private fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}

@Composable
private fun RoomHeader(m: MeetingSnapshot, video: Boolean, reconnecting: Boolean, onPeople: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().background(Ms.Surface).statusBarsPadding().padding(start = 20.dp, end = 12.dp, top = 8.dp, bottom = 12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(Modifier.weight(1f)) {
            Text(m.name, style = MaterialTheme.typography.titleLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
            val people = "${m.members.size} ${if (m.members.size == 1) "persona" else "personas"}"
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(7.dp).background(if (reconnecting) Ms.Hand else if (video) Ms.Ok else Ms.Line, RoundedCornerShape(50)))
                Spacer(Modifier.width(6.dp))
                Text(
                    "$people · " + when { reconnecting -> "reconectando"; video -> "conexión buena"; else -> "conectando el video…" },
                    style = MaterialTheme.typography.bodySmall, color = Ms.Muted
                )
            }
        }
        RoundButton(Ic.Users, "Personas", onPeople)
    }
}

@Composable
private fun ReconnectBanner(attempt: Int, max: Int) {
    val t = rememberInfiniteTransition(label = "puntos")
    val p by t.animateFloat(0f, 3f, infiniteRepeatable(tween(1200, easing = LinearEasing), RepeatMode.Restart), label = "p")
    Column(Modifier.fillMaxWidth().background(Ms.WarnSoft).padding(horizontal = 20.dp, vertical = 12.dp)) {
        Text("Se perdió la conexión con la PC anfitriona. Reconectando" + ".".repeat(p.toInt() + 1) + " (intento $attempt de $max)", style = MaterialTheme.typography.bodyMedium, color = Ms.Warn)
        Text("Revisa que sigues en la red de la universidad. Si cambiaste de red, vuelve a unirte.", style = MaterialTheme.typography.bodySmall, color = Ms.Warn)
    }
}

@Composable
private fun PresentingBanner(onStop: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().background(Ms.DangerSoft, RoundedCornerShape(14.dp)).padding(start = 14.dp, end = 8.dp, top = 8.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        val t = rememberInfiniteTransition(label = "rec")
        val a by t.animateFloat(0.35f, 1f, infiniteRepeatable(tween(800), RepeatMode.Reverse), label = "a")
        Box(Modifier.size(10.dp).graphicsLayer { alpha = a }.background(Ms.Danger, RoundedCornerShape(50)))
        Spacer(Modifier.width(10.dp))
        Text("Estás presentando tu pantalla", style = MaterialTheme.typography.titleSmall, color = Ms.Danger, modifier = Modifier.weight(1f))
        MsButton("Detener", onStop, kind = BtnKind.Danger, small = true, icon = Ic.Stop)
    }
}

/** La presentacion crece desde el centro al aparecer (prototipo, «Unirse»). */
@Composable
private fun Stage(m: MeetingSnapshot, remote: VideoTrack?, local: VideoTrack?, egl: EglBase, onFullscreen: () -> Unit) {
    Box(
        Modifier.fillMaxWidth().aspectRatio(16f / 10f).clip(RoundedCornerShape(18.dp)).background(Ms.Stage),
        contentAlignment = Alignment.Center
    ) {
        val track = local ?: remote
        if (track != null) {
            var shown by remember(track) { mutableStateOf(false) }
            LaunchedEffect(track) { shown = true }
            val s by animateFloatAsState(if (shown) 1f else 0.92f, tween(400, easing = Motion.Ease), label = "crecer")
            Box(Modifier.fillMaxSize().graphicsLayer { scaleX = s; scaleY = s; alpha = (s - 0.92f) / 0.08f }) {
                VideoView(track, egl, Modifier.fillMaxSize())
            }
            Text(
                if (local != null) "Tú presentas" else "${m.presenterName} presenta",
                style = MaterialTheme.typography.labelMedium, color = Color.White,
                modifier = Modifier.align(Alignment.BottomStart).padding(10.dp).background(Color.Black.copy(alpha = 0.55f), RoundedCornerShape(50)).padding(horizontal = 10.dp, vertical = 4.dp)
            )
            if (remote != null && local == null) {
                RoundButton(
                    Ic.Maximize, "Pantalla completa", onFullscreen, Modifier.align(Alignment.BottomEnd).padding(8.dp),
                    size = 36.dp, bg = Color.Black.copy(alpha = 0.55f), fg = Color.White, bordered = false
                )
            }
        } else {
            Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.padding(20.dp)) {
                Icon(Ic.Monitor, null, tint = Color.White.copy(alpha = 0.5f), modifier = Modifier.size(32.dp))
                Spacer(Modifier.height(10.dp))
                if (m.presenter != null) {
                    Text("${m.presenterName} está presentando", style = MaterialTheme.typography.titleMedium, color = Color.White)
                    Text("Conectando el video…", style = MaterialTheme.typography.bodySmall, color = Color.White.copy(alpha = 0.7f))
                } else {
                    Text("Nadie está presentando", style = MaterialTheme.typography.titleMedium, color = Color.White)
                    Text("Cuando alguien comparta su pantalla, aparecerá aquí.", style = MaterialTheme.typography.bodySmall, color = Color.White.copy(alpha = 0.7f))
                }
            }
        }
    }
}

@Composable
private fun SoundRow(presenter: String, muted: Boolean, onToggle: () -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
        Icon(if (muted) Ic.VolumeOff else Ic.Volume, null, tint = Ms.Muted, modifier = Modifier.size(18.dp))
        Spacer(Modifier.width(8.dp))
        Text(
            if (muted) "Silenciaste el sonido de la PC de $presenter" else "Escuchas el sonido de la PC de $presenter",
            style = MaterialTheme.typography.bodySmall, color = Ms.Muted, modifier = Modifier.weight(1f)
        )
        TextButton(onClick = onToggle) { Text(if (muted) "Activar" else "Silenciar", color = Ms.Accent) }
    }
    Text("Gira el teléfono o usa el botón de pantalla completa para verla más grande.", style = MaterialTheme.typography.bodySmall, color = Ms.Muted)
}

@Composable
private fun VideoBlocked(onRetry: () -> Unit, onDismiss: () -> Unit) {
    Card(Modifier.fillMaxWidth()) {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Callout("El audio y el chat siguen funcionando.", tone = Tone.Warn, icon = Ic.WifiOff, title = "Tu red bloquea el vídeo")
            Text("¿Qué puedes hacer?", style = MaterialTheme.typography.titleSmall)
            Text(
                "• Reintentar: a veces la red tarda en abrir el camino.\n" +
                    "• Cambiar a datos móviles no sirve: debes estar en la red de la universidad.\n" +
                    "• Pedir a TI que permita el tráfico UDP desde el Wi-Fi hacia la PC del docente.",
                style = MaterialTheme.typography.bodySmall, color = Ms.Muted
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                MsButton("Reintentar", onRetry, icon = Ic.Refresh, small = true)
                MsButton("Seguir solo con el chat", onDismiss, kind = BtnKind.Ghost, small = true)
            }
        }
    }
}

@Composable
private fun ControlCard(m: MeetingSnapshot, onPeople: () -> Unit) {
    val staff = m.myself?.role?.isStaff == true
    if (!staff) return
    Card(Modifier.fillMaxWidth()) {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Ic.Pointer, null, tint = Ms.Accent, modifier = Modifier.size(20.dp))
                Spacer(Modifier.width(8.dp))
                Text("Controla una PC desde aquí", style = MaterialTheme.typography.titleSmall)
            }
            Text("Pide el control de la PC de alguien de la sala y úsala con el teléfono como touchpad.", style = MaterialTheme.typography.bodySmall, color = Ms.Muted)
            MsButton("Controlar otra PC", onPeople, Modifier.fillMaxWidth(), kind = BtnKind.Secondary, icon = Ic.Pointer)
        }
    }
}

/** Barra inferior: Personas, Mensajes, Mano, Presentar, Salir. */
@Composable
private fun RoomBar(presenting: Boolean, slots: RoomBarSlots, onPeople: () -> Unit, onPresent: () -> Unit, onLeave: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().background(Ms.Surface).navigationBarsPadding().padding(horizontal = 8.dp, vertical = 6.dp),
        horizontalArrangement = Arrangement.SpaceEvenly
    ) {
        BarItem(Ic.Users, "Personas", onClick = onPeople)
        slots.messages?.let { BarItem(Ic.Chat, "Mensajes", badge = slots.unread, onClick = it) }
        slots.hand?.let { BarItem(Ic.Hand, if (slots.handUp) "Bajar" else "Mano", active = slots.handUp, onClick = it) }
        BarItem(if (presenting) Ic.Stop else Ic.Monitor, if (presenting) "Detener" else "Presentar", active = presenting, onClick = onPresent)
        BarItem(Ic.Leave, "Salir", danger = true, onClick = onLeave)
    }
}

@Composable
private fun RowScope.BarItem(icon: ImageVector, label: String, active: Boolean = false, danger: Boolean = false, badge: Int = 0, onClick: () -> Unit) {
    val interaction = remember { MutableInteractionSource() }
    val tint = when { danger -> Ms.Danger; active -> Ms.Accent; else -> Ms.Fg }
    Column(
        Modifier.weight(1f).pressScale(interaction).clip(RoundedCornerShape(14.dp))
            .clickable(interaction, androidx.compose.material3.ripple(), role = Role.Button, onClick = onClick)
            .padding(vertical = 6.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Box {
            Box(Modifier.size(44.dp, 32.dp).background(if (active) Ms.AccentSoft else Color.Transparent, RoundedCornerShape(50)), contentAlignment = Alignment.Center) {
                Icon(icon, label, tint = tint, modifier = Modifier.size(22.dp))
            }
            if (badge > 0) Badge(badge, Modifier.align(Alignment.TopEnd))
        }
        Spacer(Modifier.height(2.dp))
        Text(label, style = MaterialTheme.typography.labelSmall, color = tint)
    }
}

/** El contador late una vez cuando cambia (prototipo, «Mensaje nuevo»). */
@Composable
private fun Badge(count: Int, modifier: Modifier) {
    var pulse by remember { mutableStateOf(false) }
    LaunchedEffect(count) { pulse = true; delay(160); pulse = false }
    val s by animateFloatAsState(if (pulse) 1.25f else 1f, tween(160), label = "latido")
    AnimatedVisibility(true, modifier, enter = scaleIn()) {
        Box(
            Modifier.graphicsLayer { scaleX = s; scaleY = s }.size(18.dp).background(Ms.Danger, RoundedCornerShape(50)),
            contentAlignment = Alignment.Center
        ) { Text(if (count > 9) "9+" else "$count", style = MaterialTheme.typography.labelSmall, color = Color.White) }
    }
}

/** Pantalla 06: la presentacion a pantalla completa en horizontal. */
@Composable
private fun FullscreenStage(track: VideoTrack, egl: EglBase, presenter: String?, onExit: () -> Unit) {
    var chrome by remember { mutableStateOf(true) }
    LaunchedEffect(chrome) { if (chrome) { delay(3000); chrome = false } }
    BackHandler(onBack = onExit)
    com.mirrorstudio.app.presentation.ui.DarkSystemBars()
    Box(Modifier.fillMaxSize().background(Color.Black).clickable(remember { MutableInteractionSource() }, null) { chrome = !chrome }) {
        VideoView(track, egl, Modifier.fillMaxSize())
        AnimatedVisibility(chrome, enter = fadeIn(), exit = fadeOut(), modifier = Modifier.fillMaxSize()) {
            Box(Modifier.fillMaxSize().padding(16.dp)) {
                Text(
                    "${presenter.orEmpty()} presenta", color = Color.White, style = MaterialTheme.typography.labelMedium,
                    modifier = Modifier.align(Alignment.TopStart).background(Color.Black.copy(alpha = 0.55f), RoundedCornerShape(50)).padding(horizontal = 10.dp, vertical = 4.dp)
                )
                RoundButton(Ic.Minimize, "Salir de pantalla completa", onExit, Modifier.align(Alignment.TopEnd), bg = Color.Black.copy(alpha = 0.55f), fg = Color.White, bordered = false)
            }
        }
    }
}

/** Pantalla 20: la camara del telefono es la presentacion de la sala. */
@Composable
private fun CameraPresentScreen(track: VideoTrack, egl: EglBase, onSwitch: () -> Unit, onStop: () -> Unit) {
    BackHandler(onBack = onStop)
    com.mirrorstudio.app.presentation.ui.DarkSystemBars()
    Box(Modifier.fillMaxSize().background(Color.Black)) {
        VideoView(track, egl, Modifier.fillMaxSize(), fill = true)
        Row(
            Modifier.align(Alignment.TopCenter).statusBarsPadding().padding(12.dp).background(Ms.Danger, RoundedCornerShape(50)).padding(horizontal = 14.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box(Modifier.size(8.dp).background(Color.White, RoundedCornerShape(50)))
            Spacer(Modifier.width(8.dp))
            Text("Toda la sala ve tu cámara", color = Color.White, style = MaterialTheme.typography.labelMedium)
        }
        Row(
            Modifier.align(Alignment.BottomCenter).fillMaxWidth().navigationBarsPadding().padding(20.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            RoundButton(Ic.Refresh, "Cambiar de cámara", onSwitch, size = 52.dp, bg = Color.Black.copy(alpha = 0.5f), fg = Color.White, bordered = false)
            MsButton("Dejar de mostrar", onStop, Modifier.weight(1f), kind = BtnKind.Danger, icon = Ic.Stop, large = true)
        }
    }
}
