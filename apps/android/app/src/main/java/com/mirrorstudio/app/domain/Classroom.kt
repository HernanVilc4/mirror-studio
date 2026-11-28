package com.mirrorstudio.app.domain

import android.net.Uri
import kotlinx.coroutines.flow.StateFlow

/** Funciones de aula del protocolo v5 (DECISIONES.md, secciones 3 a 9), sin detalles de red. */

enum class Device { PC, PHONE }

/** Quien puede escribir o compartir: `room-settings`. */
enum class Allow { ALL, TEACHERS, OFF }

data class RoomSettings(val chat: Allow = Allow.ALL, val share: Allow = Allow.ALL, val locked: Boolean = false)

/** Destino de un mensaje. */
sealed interface Audience {
    data object All : Audience
    data object Teachers : Audience
    data class People(val ids: List<String>) : Audience
}

sealed interface MessageBody {
    data class Text(val text: String) : MessageBody
    data class Question(val text: String) : MessageBody
    data class Link(val url: String, val title: String?) : MessageBody
    data class File(val fileId: String) : MessageBody
    data class Poll(val pollId: String) : MessageBody
}

data class ChatMessage(
    val id: String,
    val from: String,
    val fromName: String,
    val fromRole: MemberRole?,
    val at: Long,
    val to: Audience,
    val body: MessageBody,
    val mine: Boolean,
    val answered: Boolean = false,
    val shown: Boolean = false,
    val deleted: Boolean = false
)

data class Poll(
    val id: String,
    val question: String,
    val options: List<String>,
    val multi: Boolean,
    val anonymous: Boolean,
    val closed: Boolean,
    /** Null si todavia no se pueden ver (resultados al cerrar). */
    val counts: List<Int>?,
    val total: Int,
    val mine: Boolean,
    val myChoices: List<Int> = emptyList()
)

data class SharedFile(
    val id: String,
    val name: String,
    val size: Long,
    val mime: String?,
    /** 0..1 mientras se sube o se descarga; null si no hay transferencia. */
    val progress: Float? = null,
    /** Donde quedo guardado en el telefono. */
    val savedTo: Uri? = null,
    val error: String? = null
)

data class Classroom(
    val supported: Boolean = false,
    val settings: RoomSettings = RoomSettings(),
    val messages: List<ChatMessage> = emptyList(),
    val unread: Int = 0,
    val polls: Map<String, Poll> = emptyMap(),
    val files: Map<String, SharedFile> = emptyMap(),
    /** Silenciado en el chat por un docente. */
    val chatMuted: Boolean = false,
    /** Personas silenciadas (solo lo ven los docentes). */
    val mutedIds: Set<String> = emptySet(),
    /** Ultima pregunta escrita al levantar la mano. */
    val handText: String? = null
)

enum class SlideAction { NEXT, PREV, FIRST, LAST, BLACK, WHITE, START, END }

enum class InkColor { RED, BLUE, YELLOW, BLACK }
enum class InkTool { PEN, HIGHLIGHTER }

interface ClassroomRepository {
    val classroom: StateFlow<Classroom>

    fun markRead()
    suspend fun send(to: Audience, body: MessageBody): String?
    suspend fun sendFile(to: Audience, uri: Uri): String?
    suspend fun download(fileId: String): String?
    suspend fun deleteMessage(id: String)
    suspend fun markAnswered(id: String, answered: Boolean)
    suspend fun showToAll(id: String, anonymous: Boolean)
    suspend fun muteChat(target: String, on: Boolean)
    suspend fun setSettings(settings: RoomSettings)

    suspend fun raiseHand(text: String?)
    suspend fun lowerHand()
    suspend fun lowerHandOf(target: String)

    suspend fun createPoll(question: String, options: List<String>, multi: Boolean, anonymous: Boolean, resultsOnClose: Boolean): String?
    suspend fun vote(pollId: String, choices: List<Int>)
    suspend fun closePoll(pollId: String)

    /** Vincula este telefono con la PC del QR (`pair-claim`). */
    suspend fun pair(token: String): String?
    suspend fun unpair()
    suspend fun slide(action: SlideAction)
    suspend fun pointer(x: Float, y: Float, on: Boolean)
    suspend fun ink(stroke: Int, points: List<Pair<Float, Float>>, color: InkColor, width: Int, tool: InkTool, done: Boolean)
    suspend fun inkUndo()
    suspend fun inkClear()
}
