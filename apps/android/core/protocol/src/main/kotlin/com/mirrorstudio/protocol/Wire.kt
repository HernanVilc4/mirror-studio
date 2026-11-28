package com.mirrorstudio.protocol

import kotlinx.serialization.SerialName
import kotlinx.serialization.SerializationException
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject

// Espejo de packages/protocol/src/index.ts. Si algo cambia alla, cambia aqui y en los vectores de prueba.

const val PROTOCOL_VERSION = 5
const val DEFAULT_PORT = 47800
const val MAX_PARTICIPANTS = 35

@Serializable
enum class Role {
    @SerialName("creator") CREATOR,
    @SerialName("admin") ADMIN,
    @SerialName("teacher") TEACHER,
    @SerialName("participant") PARTICIPANT
}

@Serializable
enum class AssignableRole {
    @SerialName("admin") ADMIN,
    @SerialName("teacher") TEACHER,
    @SerialName("participant") PARTICIPANT
}

/** Quien puede pedir el control de otra PC (el anfitrion lo valida de nuevo). */
fun Role.canRequestControl(): Boolean = this != Role.PARTICIPANT

@Serializable
enum class Device { @SerialName("pc") PC, @SerialName("phone") PHONE }

@Serializable
data class Participant(
    val id: String,
    val name: String,
    val role: Role,
    val host: Boolean? = null,
    val device: Device = Device.PC,
    /** Puesto en la fila de manos (1 = primero); null con la mano bajada. */
    val hand: Int? = null,
    val pairedWith: String? = null
)

@Serializable
enum class PresentSource { @SerialName("screen") SCREEN, @SerialName("window") WINDOW, @SerialName("camera") CAMERA }

@Serializable
enum class Allow { @SerialName("all") ALL, @SerialName("teachers") TEACHERS, @SerialName("off") OFF }

@Serializable
data class RoomSettings(val chat: Allow = Allow.ALL, val share: Allow = Allow.ALL, val locked: Boolean = false)

@Serializable
data class ControlGrant(val controller: String, val target: String)

@Serializable
data class SessionState(
    val sessionId: String,
    val name: String,
    val participants: List<Participant>,
    val presenter: String? = null,
    val controls: List<ControlGrant> = emptyList(),
    val presenterSource: PresentSource? = null,
    val settings: RoomSettings = RoomSettings()
)

// ---- entrada de control remoto (coordenadas normalizadas 0..1 sobre la pantalla principal de la PC controlada) ----

@Serializable
sealed interface ControlInput

@Serializable
@SerialName("mouse-move")
data class MouseMove(val x: Double, val y: Double) : ControlInput

@Serializable
enum class MouseButtonKind {
    @SerialName("left") LEFT,
    @SerialName("right") RIGHT,
    @SerialName("middle") MIDDLE
}

@Serializable
@SerialName("mouse-button")
data class MouseButton(val button: MouseButtonKind, val down: Boolean) : ControlInput

@Serializable
@SerialName("wheel")
data class Wheel(val dx: Int, val dy: Int) : ControlInput

/** `code` es un KeyboardEvent.code ("KeyA", "Enter", ...). */
@Serializable
@SerialName("key")
data class KeyEvent(val code: String, val down: Boolean) : ControlInput

@Serializable
@SerialName("text")
data class TextEvent(val text: String) : ControlInput

@Serializable
enum class HealthCode {
    @SerialName("ok") OK,
    @SerialName("restarting") RESTARTING,
    @SerialName("blocked-admin") BLOCKED_ADMIN,
    @SerialName("blocked-secure") BLOCKED_SECURE,
    @SerialName("rejected") REJECTED
}

@Serializable
data class ControlHealth(val code: HealthCode, val detail: String? = null, val received: Int)

@Serializable
enum class RtcKind {
    @SerialName("offer") OFFER,
    @SerialName("answer") ANSWER,
    @SerialName("ice") ICE
}

// ---- cliente -> anfitrion ----

@Serializable
sealed interface ClientMessage

@Serializable @SerialName("kick") data class Kick(val target: String) : ClientMessage
@Serializable @SerialName("set-role") data class SetRole(val target: String, val role: AssignableRole) : ClientMessage
@Serializable @SerialName("present-start") data class PresentStart(val source: PresentSource = PresentSource.SCREEN) : ClientMessage
@Serializable @SerialName("present-stop") data object PresentStop : ClientMessage
@Serializable @SerialName("control-request") data class ControlRequest(val target: String) : ClientMessage
@Serializable @SerialName("control-respond") data class ControlRespond(val controller: String, val accept: Boolean) : ClientMessage
@Serializable @SerialName("control-revoke") data class ControlRevoke(val other: String) : ClientMessage
@Serializable @SerialName("control-input") data class ControlSend(val target: String, val input: ControlInput) : ClientMessage
@Serializable @SerialName("control-status") data class ControlStatus(val other: String, val health: ControlHealth) : ClientMessage
@Serializable @SerialName("control-reset") data class ControlReset(val target: String) : ClientMessage
@Serializable @SerialName("leave") data object Leave : ClientMessage

// ---- anfitrion -> cliente ----

@Serializable
sealed interface ServerMessage

@Serializable @SerialName("welcome") data class Welcome(val you: String, val state: SessionState) : ServerMessage
@Serializable @SerialName("state") data class StateMsg(val state: SessionState) : ServerMessage
@Serializable @SerialName("control-asked") data class ControlAsked(val controller: String, val name: String) : ServerMessage
@Serializable @SerialName("control-started") data class ControlStarted(val controller: String, val target: String) : ServerMessage
@Serializable @SerialName("control-ended") data class ControlEnded(val controller: String, val target: String, val reason: String) : ServerMessage
@Serializable @SerialName("control-input") data class ControlInputIn(val from: String, val input: ControlInput) : ServerMessage
@Serializable @SerialName("control-status") data class ControlStatusIn(val from: String, val health: ControlHealth) : ServerMessage
@Serializable @SerialName("control-reset") data class ControlResetIn(val from: String) : ServerMessage
@Serializable @SerialName("notice") data class Notice(val text: String) : ServerMessage
@Serializable @SerialName("closed") data class Closed(val reason: String) : ServerMessage

// Mensajes que viajan en los dos sentidos.
@Serializable
@SerialName("rtc")
data class Rtc(val kind: RtcKind, val data: String) : ClientMessage, ServerMessage

/** El video de este enlace pasa al WebSocket cifrado (rele TCP). El telefono no lo pide: solo WebRTC. */
@Serializable
@SerialName("media-mode")
data class MediaMode(val relay: Boolean = true, val reason: String? = null) : ClientMessage, ServerMessage

// ---- saludo (texto plano, antes del canal cifrado) ----

@Serializable
data class Hello(
    val t: String = "hello",
    val v: Int = PROTOCOL_VERSION,
    val pub: String,
    val nonce: String,
    val name: String,
    /** No entran en la transcripcion del saludo. El telefono nunca tiene `relay` (decision A5). */
    val device: String = "phone",
    val caps: List<String> = listOf("camera", "files")
)

@Serializable
data class HelloReply(val t: String = "hello-reply", val pub: String, val nonce: String, val salt: String)

@Serializable
data class Confirm(val t: String = "confirm", val mac: String)

@Serializable
data class ConfirmOk(val t: String = "confirm-ok", val mac: String)

@Serializable
data class Reject(val t: String = "reject", val reason: String)

@Serializable
data class InfoReply(val t: String = "info-reply", val v: Int, val name: String, val host: String, val participants: Int)

object Wire {
    /** `t` es el discriminador de todos los mensajes. Los campos nulos no se envian: zod los rechaza como `null`. */
    val json: Json = Json {
        classDiscriminator = "t"
        ignoreUnknownKeys = true
        encodeDefaults = true
        explicitNulls = false
    }

    private val handshakeJson: Json = Json { ignoreUnknownKeys = true; encodeDefaults = true; explicitNulls = false }

    fun encode(m: ClientMessage): String = json.encodeToString(ClientMessage.serializer(), m)

    /** Null si el mensaje no es de un tipo conocido (un anfitrion mas nuevo): se ignora, no se cae. */
    fun parseServer(text: String): ServerMessage? =
        try {
            json.decodeFromString(ServerMessage.serializer(), text)
        } catch (_: SerializationException) {
            null
        } catch (_: IllegalArgumentException) {
            null
        }

    fun encodeHello(m: Hello): String = handshakeJson.encodeToString(Hello.serializer(), m)
    fun encodeConfirm(m: Confirm): String = handshakeJson.encodeToString(Confirm.serializer(), m)

    /** Valor de `t` de un mensaje de saludo, o null si no es un objeto JSON con `t`. */
    fun messageType(text: String): String? =
        try {
            (handshakeJson.parseToJsonElement(text) as? JsonObject)?.get("t")?.let { (it as? JsonPrimitive)?.content }
        } catch (_: SerializationException) {
            null
        }

    fun parseHelloReply(text: String): HelloReply? = decode(HelloReply.serializer(), text)
    fun parseConfirmOk(text: String): ConfirmOk? = decode(ConfirmOk.serializer(), text)
    fun parseReject(text: String): Reject? = decode(Reject.serializer(), text)
    fun parseInfoReply(text: String): InfoReply? = decode(InfoReply.serializer(), text)

    private fun <T> decode(s: kotlinx.serialization.KSerializer<T>, text: String): T? =
        try {
            handshakeJson.decodeFromString(s, text)
        } catch (_: SerializationException) {
            null
        } catch (_: IllegalArgumentException) {
            null
        }
}

// ---- codigo de la reunion: 8 caracteres de un alfabeto de 32 sin 0, O, 1, I ----

const val CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
const val CODE_LENGTH = 8

fun normalizeCode(input: String): String =
    input.uppercase(java.util.Locale.ROOT).filter { it in 'A'..'Z' || it in '0'..'9' }

fun isValidCode(input: String): Boolean {
    val c = normalizeCode(input)
    return c.length == CODE_LENGTH && c.all { it in CODE_ALPHABET }
}

fun formatCode(code: String): String = "${code.take(4)}-${code.drop(4)}"
