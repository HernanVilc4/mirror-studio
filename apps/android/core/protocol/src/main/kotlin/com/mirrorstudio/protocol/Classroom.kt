@file:OptIn(ExperimentalSerializationApi::class)

package com.mirrorstudio.protocol

import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.descriptors.buildClassSerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonClassDiscriminator
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonEncoder
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

// Protocolo v5: funciones de aula (DECISIONES.md, secciones 3 a 10). Espejo de packages/protocol/src/index.ts;
// los vectores de packages/protocol/vectors comprueban que coinciden.

@Serializable
enum class SlideAction {
    @SerialName("next") NEXT, @SerialName("prev") PREV, @SerialName("first") FIRST, @SerialName("last") LAST,
    @SerialName("black") BLACK, @SerialName("white") WHITE, @SerialName("start") START, @SerialName("end") END
}

@Serializable
enum class InkColor { @SerialName("red") RED, @SerialName("blue") BLUE, @SerialName("yellow") YELLOW, @SerialName("black") BLACK }

@Serializable
enum class InkTool { @SerialName("pen") PEN, @SerialName("highlighter") HIGHLIGHTER }

@Serializable
enum class ShowResults { @SerialName("live") LIVE, @SerialName("on-close") ON_CLOSE }

/** Destino de un mensaje: `'all'`, `'teachers'` o una lista de ids. */
@Serializable(with = MsgToSerializer::class)
sealed interface MsgTo {
    data object All : MsgTo
    data object Teachers : MsgTo
    data class People(val ids: List<String>) : MsgTo
}

object MsgToSerializer : KSerializer<MsgTo> {
    override val descriptor: SerialDescriptor = buildClassSerialDescriptor("MsgTo")
    override fun serialize(encoder: Encoder, value: MsgTo) {
        val e = encoder as JsonEncoder
        e.encodeJsonElement(
            when (value) {
                MsgTo.All -> JsonPrimitive("all")
                MsgTo.Teachers -> JsonPrimitive("teachers")
                is MsgTo.People -> JsonArray(value.ids.map(::JsonPrimitive))
            }
        )
    }
    override fun deserialize(decoder: Decoder): MsgTo {
        val el = (decoder as JsonDecoder).decodeJsonElement()
        return when {
            el is JsonArray -> MsgTo.People(el.map { (it as? JsonPrimitive)?.contentOrNull ?: throw SerializationException("id") })
            el is JsonPrimitive && el.content == "all" -> MsgTo.All
            el is JsonPrimitive && el.content == "teachers" -> MsgTo.Teachers
            else -> throw SerializationException("destino desconocido")
        }
    }
}

/** Cuerpo de un mensaje, discriminado por `kind`. El de archivo trae nombre, tamano y tipo al llegar. */
@Serializable
@JsonClassDiscriminator("kind")
sealed interface MsgBody {
    @Serializable @SerialName("text") data class Text(val text: String) : MsgBody
    @Serializable @SerialName("question") data class Question(val text: String) : MsgBody
    @Serializable @SerialName("link") data class Link(val url: String, val title: String? = null) : MsgBody
    @Serializable @SerialName("file") data class File(val fileId: Int, val name: String? = null, val size: Long? = null, val mime: String? = null) : MsgBody
    @Serializable @SerialName("poll") data class Poll(val pollId: String) : MsgBody
}

// ---- cliente -> anfitrion ----

@Serializable @SerialName("pair-create") data object PairCreate : ClientMessage
@Serializable @SerialName("pair-claim") data class PairClaim(val token: String) : ClientMessage
@Serializable @SerialName("pair-end") data object PairEnd : ClientMessage
@Serializable @SerialName("slide") data class SlideSend(val action: SlideAction) : ClientMessage
/** Solo la PC con PowerPoint (fase 2); esta aqui para que el puerto este completo. */
@Serializable @SerialName("slide-state") data class SlideStateSend(val index: Int, val total: Int, val nextTitle: String? = null, val notes: String? = null) : ClientMessage
@Serializable @SerialName("pointer") data class PointerSend(val x: Double, val y: Double, val on: Boolean) : ClientMessage
@Serializable @SerialName("ink") data class InkSend(
    val stroke: Int,
    /** Hasta 32 puntos `[x, y]` normalizados. */
    val points: List<List<Double>>,
    val color: InkColor,
    val width: Int,
    val tool: InkTool,
    val done: Boolean
) : ClientMessage
@Serializable @SerialName("ink-undo") data object InkUndo : ClientMessage
@Serializable @SerialName("ink-clear") data object InkClear : ClientMessage
@Serializable @SerialName("msg-send") data class MsgSend(val to: MsgTo, val body: MsgBody) : ClientMessage
@Serializable @SerialName("msg-delete") data class MsgDelete(val id: String) : ClientMessage
@Serializable @SerialName("msg-mark") data class MsgMark(val id: String, val answered: Boolean) : ClientMessage
@Serializable @SerialName("msg-show") data class MsgShow(val id: String, val anonymous: Boolean) : ClientMessage
@Serializable @SerialName("room-settings") data class SetRoomSettings(val chat: Allow, val share: Allow, val locked: Boolean) : ClientMessage
@Serializable @SerialName("mute-chat") data class MuteChat(val target: String, val on: Boolean) : ClientMessage
@Serializable @SerialName("hand") data class HandSend(val up: Boolean, val text: String? = null) : ClientMessage
@Serializable @SerialName("hand-lower") data class HandLower(val target: String) : ClientMessage
@Serializable @SerialName("poll-create") data class PollCreate(
    val question: String, val options: List<String>, val multi: Boolean, val anonymous: Boolean, val showResults: ShowResults
) : ClientMessage
@Serializable @SerialName("poll-vote") data class PollVote(val pollId: String, val choices: List<Int>) : ClientMessage
@Serializable @SerialName("poll-close") data class PollClose(val pollId: String) : ClientMessage
@Serializable @SerialName("file-offer") data class FileOffer(val name: String, val size: Long, val sha256: String, val mime: String) : ClientMessage
@Serializable @SerialName("file-get") data class FileGet(val fileId: Int) : ClientMessage

// ---- anfitrion -> cliente ----

@Serializable @SerialName("pair-token") data class PairToken(val token: String, val expiresAt: Long) : ServerMessage
@Serializable @SerialName("slide") data class SlideIn(val from: String, val action: SlideAction) : ServerMessage
@Serializable @SerialName("slide-state") data class SlideStateIn(
    val from: String, val index: Int, val total: Int, val nextTitle: String? = null, val notes: String? = null
) : ServerMessage
@Serializable @SerialName("pointer") data class PointerIn(val from: String, val x: Double, val y: Double, val on: Boolean) : ServerMessage
@Serializable @SerialName("ink") data class InkIn(
    val from: String, val stroke: Int, val points: List<List<Double>>, val color: InkColor, val width: Int, val tool: InkTool, val done: Boolean
) : ServerMessage
@Serializable @SerialName("ink-undo") data class InkUndoIn(val from: String) : ServerMessage
@Serializable @SerialName("ink-clear") data class InkClearIn(val from: String) : ServerMessage
@Serializable @SerialName("msg") data class Msg(
    val id: String,
    /** Null en una pregunta mostrada sin nombre. */
    val from: String? = null,
    val at: Long,
    val to: MsgTo,
    val body: MsgBody,
    val answered: Boolean? = null,
    val shown: Boolean? = null
) : ServerMessage
@Serializable @SerialName("msg-history") data class MsgHistory(val items: List<Msg>) : ServerMessage
@Serializable @SerialName("msg-delete") data class MsgDeleted(val id: String, val by: String) : ServerMessage
@Serializable data class Voter(val id: String, val choices: List<Int>)
@Serializable @SerialName("poll-state") data class PollState(
    val pollId: String,
    val question: String,
    val options: List<String>,
    val multi: Boolean,
    val anonymous: Boolean,
    val showResults: ShowResults = ShowResults.LIVE,
    val closed: Boolean,
    val counts: List<Int>? = null,
    val voters: List<Voter>? = null,
    val total: Int
) : ServerMessage
@Serializable @SerialName("file-accept") data class FileAccept(val fileId: Int) : ServerMessage
@Serializable @SerialName("file-meta") data class FileMeta(val fileId: Int, val name: String, val size: Long, val sha256: String) : ServerMessage

// ---- trozos de archivo: [0x02][fileId u32][index u32][count u32][hasta 48 KB], sellados como cualquier trama ----

const val MEDIA_TAG: Byte = 0x01
const val FILE_TAG: Byte = 0x02
const val FILE_HEADER = 13
const val FILE_CHUNK = 49152
const val FILE_MAX = 52_428_800L
private const val MAX_CHUNKS = 1067

class FileChunk(val fileId: Int, val index: Int, val count: Int, val payload: ByteArray)

fun fileChunkCount(size: Long): Int = maxOf(1, ((size + FILE_CHUNK - 1) / FILE_CHUNK).toInt())

fun encodeFileChunk(fileId: Int, index: Int, count: Int, payload: ByteArray): ByteArray {
    require(payload.size <= FILE_CHUNK)
    val out = ByteArray(FILE_HEADER + payload.size)
    out[0] = FILE_TAG
    putU32(out, 1, fileId.toLong()); putU32(out, 5, index.toLong()); putU32(out, 9, count.toLong())
    payload.copyInto(out, FILE_HEADER)
    return out
}

/** Null si la trama no es un trozo de archivo valido. */
fun parseFileChunk(frame: ByteArray): FileChunk? {
    if (frame.size < FILE_HEADER || frame[0] != FILE_TAG) return null
    val id = u32(frame, 1); val index = u32(frame, 5); val count = u32(frame, 9)
    if (id == 0L || id > Int.MAX_VALUE || count == 0L || count > MAX_CHUNKS || index >= count) return null
    if (frame.size - FILE_HEADER > FILE_CHUNK) return null
    return FileChunk(id.toInt(), index.toInt(), count.toInt(), frame.copyOfRange(FILE_HEADER, frame.size))
}

private fun putU32(b: ByteArray, at: Int, v: Long) {
    b[at] = (v shr 24).toByte(); b[at + 1] = (v shr 16).toByte(); b[at + 2] = (v shr 8).toByte(); b[at + 3] = v.toByte()
}

private fun u32(b: ByteArray, at: Int): Long =
    ((b[at].toLong() and 0xFF) shl 24) or ((b[at + 1].toLong() and 0xFF) shl 16) or ((b[at + 2].toLong() and 0xFF) shl 8) or (b[at + 3].toLong() and 0xFF)
