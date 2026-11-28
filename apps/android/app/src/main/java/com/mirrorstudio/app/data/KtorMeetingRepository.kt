package com.mirrorstudio.app.data

import android.content.Intent
import com.mirrorstudio.app.data.media.LinkState
import com.mirrorstudio.app.data.media.RtcLink
import com.mirrorstudio.app.data.media.RtcMedia
import com.mirrorstudio.app.domain.ClassroomRepository
import com.mirrorstudio.app.domain.Device as DDevice
import com.mirrorstudio.app.domain.EndKind
import com.mirrorstudio.app.domain.JoinRequest
import com.mirrorstudio.app.domain.MeetingRepository
import com.mirrorstudio.app.domain.MeetingSnapshot
import com.mirrorstudio.app.domain.Member
import com.mirrorstudio.app.domain.MemberRole
import com.mirrorstudio.app.domain.PresentSource
import com.mirrorstudio.app.domain.RoomExtras
import com.mirrorstudio.app.domain.SessionStatus
import com.mirrorstudio.app.domain.endKindOf
import com.mirrorstudio.network.JoinException
import com.mirrorstudio.network.MeetingConnection
import com.mirrorstudio.protocol.AssignableRole
import com.mirrorstudio.protocol.ClientMessage
import com.mirrorstudio.protocol.Kick
import com.mirrorstudio.protocol.SetRole
import com.mirrorstudio.protocol.Closed
import com.mirrorstudio.protocol.ControlAsked
import com.mirrorstudio.protocol.ControlEnded
import com.mirrorstudio.protocol.ControlInput
import com.mirrorstudio.protocol.ControlRequest
import com.mirrorstudio.protocol.ControlRespond
import com.mirrorstudio.protocol.ControlRevoke
import com.mirrorstudio.protocol.ControlSend
import com.mirrorstudio.protocol.ControlReset
import com.mirrorstudio.protocol.ControlStarted
import com.mirrorstudio.protocol.ControlStatusIn
import com.mirrorstudio.protocol.HealthCode
import com.mirrorstudio.protocol.MediaMode
import com.mirrorstudio.protocol.Notice
import com.mirrorstudio.protocol.PresentStart
import com.mirrorstudio.protocol.PresentStop
import com.mirrorstudio.protocol.Role
import com.mirrorstudio.protocol.Rtc
import com.mirrorstudio.protocol.ServerMessage
import com.mirrorstudio.protocol.SessionState
import com.mirrorstudio.protocol.StateMsg
import com.mirrorstudio.protocol.Welcome
import io.ktor.client.HttpClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

private const val RECONNECT_TRIES = 5

/**
 * Una sola reunion a la vez. Vive lo que vive la app (scope de aplicacion). Ademas del WebSocket cifrado lleva
 * el enlace WebRTC con el centro de medios del anfitrion.
 */
class KtorMeetingRepository(
    private val http: HttpClient,
    private val scope: CoroutineScope,
    private val media: RtcMedia,
    private val engine: ClassroomEngine
) : MeetingRepository, ClassroomRepository by engine {

    private val _status = MutableStateFlow<SessionStatus>(SessionStatus.Idle)
    override val status: StateFlow<SessionStatus> = _status.asStateFlow()

    private val _notices = Channel<String>(Channel.BUFFERED)
    override val notices: Flow<String> = _notices.receiveAsFlow()

    private val _extras = MutableStateFlow(RoomExtras())
    override val extras: StateFlow<RoomExtras> = _extras.asStateFlow()

    private val _link = MutableStateFlow<RtcLink?>(null)
    /** Para pintar el video (la UI necesita las pistas de WebRTC). */
    val link: StateFlow<RtcLink?> = _link.asStateFlow()
    val egl get() = media.egl

    private val lock = Mutex()
    private var connection: MeetingConnection? = null
    private var reader: Job? = null
    private var linkWatch: Job? = null
    private var lastRequest: JoinRequest? = null
    private var me: String = ""
    private var snapshot: MeetingSnapshot? = null

    override suspend fun join(request: JoinRequest): String? = lock.withLock { connect(request, reconnecting = false) }

    /** Debe llamarse con [lock] tomado. */
    private suspend fun connect(request: JoinRequest, reconnecting: Boolean): String? {
        if (connection != null) return "Ya estás en una reunión"
        lastRequest = request
        if (!reconnecting) _status.value = SessionStatus.Connecting(request.host)
        val conn = try {
            MeetingConnection.connect(http, request.host, request.port, request.code, request.name)
        } catch (e: JoinException) {
            android.util.Log.w("MirrorStudio", "No se pudo entrar: ${e.message}", e.cause)
            if (!reconnecting) _status.value = SessionStatus.Idle
            return e.message ?: "No se pudo entrar"
        }
        // El anfitrion manda "welcome" justo despues del saludo: esperarlo antes de mostrar la sala.
        val welcome = conn.incoming.receiveCatching().getOrNull() as? Welcome
        if (welcome == null) {
            conn.leave()
            if (!reconnecting) _status.value = SessionStatus.Idle
            return "El anfitrión cerró la conexión al entrar"
        }
        connection = conn
        me = welcome.you
        engine.attach(conn, me)
        _extras.value = RoomExtras(muted = _extras.value.muted)
        publish(welcome.state)
        openMedia(conn)

        reader = scope.launch {
            var reason: String? = null
            for (msg in conn.incoming) {
                if (msg is Closed) reason = msg.reason else handle(conn, msg)
            }
            val ended = reason ?: conn.closed.await()
            val lost = lock.withLock {
                if (connection !== conn) return@withLock false
                connection = null
                closeMedia()
                val kind = endKindOf(ended)
                engine.detach(endMeeting = !(kind == EndKind.CONNECTION_LOST && reason == null))
                if (kind == EndKind.CONNECTION_LOST && reason == null) true
                else { _status.value = SessionStatus.Ended(ended, kind, canRetry = false); false }
            }
            if (lost) reconnect(ended)
        }
        return null
    }

    private suspend fun handle(conn: MeetingConnection, msg: ServerMessage) {
        if (engine.onMessage(msg)) return
        when (msg) {
            is StateMsg -> publish(msg.state)
            is Welcome -> { me = msg.you; publish(msg.state) }
            is Notice -> _notices.trySend(msg.text)
            is Rtc -> runCatching { _link.value?.onSignal(msg.kind, msg.data) }
            // El telefono no tiene rele TCP (decision A5): si el anfitrion lo pide, el video no llega.
            is MediaMode -> _extras.update { it.copy(videoBlocked = true) }
            // Un telefono nunca se deja controlar (decision A1).
            is ControlAsked -> runCatching { conn.send(ControlRespond(msg.controller, false)) }
            is ControlStarted -> if (msg.controller == me) _extras.update { it.copy(controlPending = null, controlling = msg.target) }
            is ControlStatusIn -> if (msg.from == _extras.value.controlling) {
                val name = snapshot?.members?.firstOrNull { it.id == msg.from }?.name ?: "la PC"
                val problem = when (msg.health.code) {
                    HealthCode.OK -> null
                    HealthCode.RESTARTING -> "Reiniciando el control en $name…"
                    HealthCode.BLOCKED_ADMIN -> "Windows bloquea el control: en $name hay una ventana de administrador delante" +
                        (msg.health.detail?.let { " («$it»)" } ?: "") + ". Pídele que la cambie o la cierre."
                    HealthCode.BLOCKED_SECURE -> "$name está en una pantalla segura de Windows (inicio de sesión o permiso de administrador). Espera a que la cierren."
                    HealthCode.REJECTED -> "$name no acepta la entrada. Prueba «Reintentar el control»."
                }
                _extras.update { it.copy(controlProblem = problem) }
            }
            is ControlEnded -> if (msg.controller == me) {
                _extras.update { it.copy(controlPending = null, controlling = null, controlProblem = null) }
                if (msg.reason.isNotBlank()) _notices.trySend(msg.reason)
            }
            else -> Unit
        }
    }

    private fun publish(state: SessionState) {
        val s = state.toSnapshot(me)
        snapshot = s
        engine.onState(state, s)
        _status.value = SessionStatus.InMeeting(s)
        if (_extras.value.presenting != null && s.presenter?.isMe != true) {
            // Otro empezo a presentar o el docente me corto: dejo de enviar.
            _link.value?.stopSending()
            _extras.update { it.copy(presenting = null) }
        }
    }

    private suspend fun openMedia(conn: MeetingConnection) {
        val l = media.open { kind, data -> scope.launch { runCatching { conn.send(Rtc(kind, data)) } } }
        l.setMuted(_extras.value.muted)
        _link.value = l
        linkWatch = scope.launch { l.state.collect { st -> _extras.update { it.copy(videoConnected = st == LinkState.CONNECTED) } } }
        runCatching { l.start() }
    }

    private fun closeMedia() {
        linkWatch?.cancel()
        _link.value?.close()
        _link.value = null
    }

    /** Pantalla 14: hasta 5 intentos con espera creciente; mientras, la sala se ve atenuada. */
    private suspend fun reconnect(reason: String) {
        val request = lastRequest
        val last = snapshot
        if (request == null || last == null) { engine.detach(true); _status.value = SessionStatus.Ended(reason, EndKind.CONNECTION_LOST, true); return }
        for (attempt in 1..RECONNECT_TRIES) {
            _status.value = SessionStatus.Reconnecting(last, attempt, RECONNECT_TRIES)
            delay(1000L * attempt)
            val error = lock.withLock {
                if (_status.value !is SessionStatus.Reconnecting) return
                connect(request, reconnecting = true)
            }
            if (error == null) { _notices.trySend("Conexión recuperada"); return }
        }
        engine.detach(true)
        _status.value = SessionStatus.Ended(reason, EndKind.CONNECTION_LOST, canRetry = true)
    }

    override suspend fun rejoin(): String? {
        val r = lastRequest ?: return "No hay una reunión a la que volver"
        return join(r)
    }

    override suspend fun leave() {
        val conn = lock.withLock {
            val c = connection
            connection = null
            closeMedia()
            c
        }
        reader?.cancel()
        engine.detach(true)
        conn?.leave()
        _extras.value = RoomExtras(muted = _extras.value.muted)
        _status.value = SessionStatus.Idle
    }

    override fun acknowledgeEnded() {
        _status.compareAndSet(_status.value.takeIf { it is SessionStatus.Ended } ?: return, SessionStatus.Idle)
    }

    private suspend fun send(m: ClientMessage) { runCatching { connection?.send(m) } }

    override fun setMuted(on: Boolean) {
        _link.value?.setMuted(on)
        _extras.update { it.copy(muted = on) }
    }

    override suspend fun present(source: PresentSource, screenPermission: Intent?, width: Int, height: Int): String? {
        val l = _link.value ?: return "El video todavía no está conectado"
        if (snapshot?.presenter?.let { !it.isMe } == true) return "Ya hay alguien presentando"
        val ok = when (source) {
            PresentSource.CAMERA -> l.startCamera()
            PresentSource.SCREEN -> {
                val p = screenPermission ?: return "Falta el permiso para compartir la pantalla"
                l.startScreen(p, width, height) { scope.launch { stopPresenting() } }
                true
            }
        }
        if (!ok) return "No se pudo abrir la cámara"
        _extras.update { it.copy(presenting = source) }
        send(PresentStart(if (source == PresentSource.CAMERA) com.mirrorstudio.protocol.PresentSource.CAMERA else com.mirrorstudio.protocol.PresentSource.SCREEN))
        return null
    }

    override suspend fun stopPresenting() {
        if (_extras.value.presenting == null) return
        _link.value?.stopSending()
        _extras.update { it.copy(presenting = null) }
        send(PresentStop)
    }

    suspend fun kick(target: String) = send(Kick(target))
    suspend fun setRole(target: String, teacher: Boolean) = send(SetRole(target, if (teacher) AssignableRole.TEACHER else AssignableRole.PARTICIPANT))

    /** «Reintentar» del video: se vuelve a entrar para abrir un enlace WebRTC nuevo. */
    suspend fun reconnectMedia() {
        val r = lastRequest ?: return
        leave()
        join(r)
    }

    override fun switchCamera() { _link.value?.switchCamera() }

    override suspend fun requestControl(target: String) {
        _extras.update { it.copy(controlPending = target) }
        send(ControlRequest(target))
    }

    override suspend fun stopControl() {
        val target = _extras.value.controlling ?: _extras.value.controlPending ?: return
        _extras.update { it.copy(controlling = null, controlPending = null) }
        send(ControlRevoke(target))
    }

    override suspend fun resetControl() {
        val target = _extras.value.controlling ?: return
        _extras.update { it.copy(controlProblem = null) }
        send(ControlReset(target))
    }

    override suspend fun sendControl(input: ControlInput) {
        val target = _extras.value.controlling ?: return
        send(ControlSend(target, input))
    }
}

internal fun SessionState.toSnapshot(me: String) = MeetingSnapshot(
    name = name,
    me = me,
    members = participants.map {
        Member(
            id = it.id,
            name = it.name,
            role = when (it.role) {
                Role.CREATOR -> MemberRole.CREATOR
                Role.ADMIN -> MemberRole.ADMIN
                Role.TEACHER -> MemberRole.TEACHER
                Role.PARTICIPANT -> MemberRole.PARTICIPANT
            },
            isHost = it.host == true,
            isMe = it.id == me,
            isPresenting = it.id == presenter,
            device = if (it.device == com.mirrorstudio.protocol.Device.PHONE) DDevice.PHONE else DDevice.PC,
            hand = it.hand,
            pairedWith = it.pairedWith
        )
    }.sortedWith(compareBy<Member>({ !it.isMe }, { it.role.ordinal }, { it.name.lowercase() })),
    presenterName = participants.firstOrNull { it.id == presenter }?.name
)
