package com.mirrorstudio.app.domain

/** Modelos propios de la app: la UI no depende de los mensajes del protocolo. */

enum class MemberRole(val label: String) {
    CREATOR("Creador"), ADMIN("Admin"), TEACHER("Docente"), PARTICIPANT("Participante");

    /** Docentes o superiores: moderan, crean encuestas, piden control. */
    val isStaff: Boolean get() = this != PARTICIPANT
}

data class Member(
    val id: String,
    val name: String,
    val role: MemberRole,
    val isHost: Boolean,
    val isMe: Boolean,
    val isPresenting: Boolean,
    val device: Device = Device.PC,
    /** Puesto en la fila de manos (1 = primero), o null con la mano bajada. */
    val hand: Int? = null,
    /** Telefono <-> PC del mismo dueno. */
    val pairedWith: String? = null
)

data class MeetingSnapshot(
    val name: String,
    val me: String,
    val members: List<Member>,
    val presenterName: String?
) {
    val myself: Member? get() = members.firstOrNull { it.isMe }
    val presenter: Member? get() = members.firstOrNull { it.isPresenting }
    val hands: List<Member> get() = members.filter { it.hand != null }.sortedBy { it.hand }
    /** La PC con la que este telefono esta vinculado. */
    val pairedPc: Member? get() = myself?.pairedWith?.let { id -> members.firstOrNull { it.id == id } }
    fun nameOf(id: String): String = members.firstOrNull { it.id == id }?.name ?: "Alguien que salió"
}

data class JoinRequest(val host: String, val port: Int, val code: String, val name: String)

sealed interface SessionStatus {
    data object Idle : SessionStatus
    data class Connecting(val host: String) : SessionStatus
    data class InMeeting(val meeting: MeetingSnapshot) : SessionStatus
    /** Se corto la red: se sigue mostrando la sala atenuada mientras se reintenta (pantalla 14). */
    data class Reconnecting(val meeting: MeetingSnapshot, val attempt: Int, val max: Int) : SessionStatus
    /** La reunion termino; se muestra la pantalla de fin con [reason]. */
    data class Ended(val reason: String, val kind: EndKind, val canRetry: Boolean) : SessionStatus
}

enum class EndKind { FINISHED, KICKED, CONNECTION_LOST, LEFT }

/** Clasifica el motivo que manda el anfitrion o la red. */
fun endKindOf(reason: String): EndKind {
    val r = reason.lowercase()
    return when {
        "expuls" in r -> EndKind.KICKED
        "saliste" in r -> EndKind.LEFT
        "perdi" in r || "conexión cerrada" in r || "se desconect" in r -> EndKind.CONNECTION_LOST
        else -> EndKind.FINISHED
    }
}

/** Lo que comparte el telefono. */
enum class PresentSource { CAMERA, SCREEN }

/** Estado de la sala que no viene en `state`: video, control remoto y lo que comparto. */
data class RoomExtras(
    /** El anfitrion pidio pasar el video al rele TCP, que el telefono no tiene (pantalla 33). */
    val videoBlocked: Boolean = false,
    val videoConnected: Boolean = false,
    val muted: Boolean = false,
    val presenting: PresentSource? = null,
    /** Pedi controlar esta PC y espero respuesta. */
    val controlPending: String? = null,
    /** Estoy controlando esta PC. */
    val controlling: String? = null,
    /** La PC que controlo avisa de un problema (pantalla 09). */
    val controlProblem: String? = null
)
