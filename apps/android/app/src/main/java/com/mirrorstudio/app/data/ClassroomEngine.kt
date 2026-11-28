package com.mirrorstudio.app.data

import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.provider.OpenableColumns
import android.webkit.MimeTypeMap
import androidx.core.content.FileProvider
import com.mirrorstudio.app.domain.Allow
import com.mirrorstudio.app.domain.Audience
import com.mirrorstudio.app.domain.ChatMessage
import com.mirrorstudio.app.domain.Classroom
import com.mirrorstudio.app.domain.ClassroomRepository
import com.mirrorstudio.app.domain.InkColor
import com.mirrorstudio.app.domain.InkTool
import com.mirrorstudio.app.domain.MeetingSnapshot
import com.mirrorstudio.app.domain.MemberRole
import com.mirrorstudio.app.domain.MessageBody
import com.mirrorstudio.app.domain.Poll
import com.mirrorstudio.app.domain.RoomSettings
import com.mirrorstudio.app.domain.SharedFile
import com.mirrorstudio.app.domain.SlideAction
import com.mirrorstudio.network.MeetingConnection
import com.mirrorstudio.protocol.ClientMessage
import com.mirrorstudio.protocol.FILE_CHUNK
import com.mirrorstudio.protocol.FILE_MAX
import com.mirrorstudio.protocol.FileAccept
import com.mirrorstudio.protocol.FileChunk
import com.mirrorstudio.protocol.FileGet
import com.mirrorstudio.protocol.FileMeta
import com.mirrorstudio.protocol.FileOffer
import com.mirrorstudio.protocol.HandLower
import com.mirrorstudio.protocol.HandSend
import com.mirrorstudio.protocol.InkClear
import com.mirrorstudio.protocol.InkSend
import com.mirrorstudio.protocol.InkUndo
import com.mirrorstudio.protocol.Msg
import com.mirrorstudio.protocol.MsgBody
import com.mirrorstudio.protocol.MsgDelete
import com.mirrorstudio.protocol.MsgDeleted
import com.mirrorstudio.protocol.MsgHistory
import com.mirrorstudio.protocol.MsgMark
import com.mirrorstudio.protocol.MsgSend
import com.mirrorstudio.protocol.MsgShow
import com.mirrorstudio.protocol.MsgTo
import com.mirrorstudio.protocol.MuteChat
import com.mirrorstudio.protocol.Notice
import com.mirrorstudio.protocol.PairClaim
import com.mirrorstudio.protocol.PairEnd
import com.mirrorstudio.protocol.PointerSend
import com.mirrorstudio.protocol.PollClose
import com.mirrorstudio.protocol.PollCreate
import com.mirrorstudio.protocol.PollState
import com.mirrorstudio.protocol.PollVote
import com.mirrorstudio.protocol.ServerMessage
import com.mirrorstudio.protocol.SessionState
import com.mirrorstudio.protocol.SetRoomSettings
import com.mirrorstudio.protocol.ShowResults
import com.mirrorstudio.protocol.SlideSend
import com.mirrorstudio.protocol.encodeFileChunk
import com.mirrorstudio.protocol.fileChunkCount
import com.mirrorstudio.protocol.toHex
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import java.io.File
import java.io.FileOutputStream
import java.security.MessageDigest
import com.mirrorstudio.protocol.Allow as WAllow
import com.mirrorstudio.protocol.InkColor as WInkColor
import com.mirrorstudio.protocol.InkTool as WInkTool
import com.mirrorstudio.protocol.SlideAction as WSlide

/**
 * Funciones de aula sobre la conexion de la reunion. La alimenta [KtorMeetingRepository]: le pasa cada mensaje
 * del anfitrion y la conexion actual. Todo permiso lo vuelve a validar el anfitrion.
 */
class ClassroomEngine(private val context: Context, private val scope: CoroutineScope) : ClassroomRepository {

    private val _classroom = MutableStateFlow(Classroom())
    override val classroom: StateFlow<Classroom> = _classroom.asStateFlow()

    private var conn: MeetingConnection? = null
    private var me = ""
    private var snapshot: MeetingSnapshot? = null
    /** Nombres de quien ya salio, para que sus mensajes sigan diciendo quien los escribio. */
    private val names = mutableMapOf<String, Pair<String, MemberRole>>()
    private val myVotes = mutableMapOf<String, List<Int>>()
    private var reading = false
    private var fileReader: Job? = null
    private val uploadLock = Mutex()
    private var pendingOffer: CompletableDeferred<Result<Int>>? = null
    private val downloads = mutableMapOf<Int, Download>()

    private class Download(val meta: CompletableDeferred<FileMeta>, val chunks: Channel<FileChunk> = Channel(Channel.UNLIMITED))

    fun attach(c: MeetingConnection, myId: String) {
        conn = c
        me = myId
        fileReader?.cancel()
        fileReader = scope.launch { for (chunk in c.files) downloads[chunk.fileId]?.chunks?.send(chunk) }
        _classroom.update { it.copy(supported = true) }
    }

    fun detach(endMeeting: Boolean) {
        conn = null
        fileReader?.cancel()
        pendingOffer?.complete(Result.failure(IllegalStateException("Se cortó la conexión")))
        downloads.values.forEach { it.chunks.close() }
        downloads.clear()
        if (endMeeting) { _classroom.value = Classroom(); names.clear(); myVotes.clear() }
    }

    fun onState(state: SessionState, s: MeetingSnapshot) {
        snapshot = s
        s.members.forEach { names[it.id] = it.name to it.role }
        _classroom.update {
            it.copy(settings = RoomSettings(state.settings.chat.toDomain(), state.settings.share.toDomain(), state.settings.locked))
        }
    }

    /** true si el mensaje era de aula. */
    fun onMessage(msg: ServerMessage): Boolean {
        when (msg) {
            is Msg -> {
                val m = msg.toDomain()
                _classroom.update { c ->
                    val unread = if (reading || m.mine) c.unread else c.unread + 1
                    c.copy(messages = (c.messages.filter { it.id != m.id } + m).takeLast(200), unread = unread, files = c.files + fileOf(msg))
                }
            }
            is MsgHistory -> _classroom.update { c ->
                c.copy(messages = msg.items.map { it.toDomain() }, files = c.files + msg.items.flatMap { fileOf(it).toList() })
            }
            is MsgDeleted -> _classroom.update { c -> c.copy(messages = c.messages.map { if (it.id == msg.id) it.copy(deleted = true) else it }) }
            is PollState -> _classroom.update { c -> c.copy(polls = c.polls + (msg.pollId to msg.toDomain())) }
            is FileAccept -> pendingOffer?.complete(Result.success(msg.fileId))
            is FileMeta -> downloads[msg.fileId]?.meta?.complete(msg)
            is Notice -> {
                pendingOffer?.takeIf { !it.isCompleted }?.complete(Result.failure(IllegalStateException(msg.text)))
                when (msg.text) {
                    "Un docente te silenció en el chat" -> _classroom.update { it.copy(chatMuted = true) }
                    "Ya puedes volver a escribir en el chat" -> _classroom.update { it.copy(chatMuted = false) }
                }
                return false // el aviso se muestra igual
            }
            else -> return false
        }
        return true
    }

    /** La pantalla de mensajes esta abierta: lo nuevo no cuenta como no leido. */
    fun setReading(on: Boolean) { reading = on; if (on) markRead() }
    override fun markRead() = _classroom.update { it.copy(unread = 0) }

    private suspend fun send(m: ClientMessage) { runCatching { conn?.send(m) } }

    // ---- mensajes ----

    override suspend fun send(to: Audience, body: MessageBody): String? {
        val b = when (body) {
            is MessageBody.Text -> MsgBody.Text(body.text.take(1000).ifBlank { return null })
            is MessageBody.Question -> MsgBody.Question(body.text.take(1000).ifBlank { return null })
            is MessageBody.Link -> {
                if (!body.url.startsWith("http://") && !body.url.startsWith("https://")) return "Solo enlaces http:// o https://"
                MsgBody.Link(body.url.take(2000), body.title?.take(120))
            }
            is MessageBody.File -> MsgBody.File(body.fileId.toInt())
            is MessageBody.Poll -> MsgBody.Poll(body.pollId)
        }
        send(MsgSend(to.toWire(), b))
        return null
    }

    override suspend fun deleteMessage(id: String) = send(MsgDelete(id))
    override suspend fun markAnswered(id: String, answered: Boolean) = send(MsgMark(id, answered))
    override suspend fun showToAll(id: String, anonymous: Boolean) = send(MsgShow(id, anonymous))
    override suspend fun muteChat(target: String, on: Boolean) {
        _classroom.update { it.copy(mutedIds = if (on) it.mutedIds + target else it.mutedIds - target) }
        send(MuteChat(target, on))
    }
    override suspend fun setSettings(settings: RoomSettings) =
        send(SetRoomSettings(settings.chat.toWire(), settings.share.toWire(), settings.locked))

    // ---- mano ----

    override suspend fun raiseHand(text: String?) {
        _classroom.update { it.copy(handText = text) }
        send(HandSend(true, text?.take(200)))
    }
    override suspend fun lowerHand() { _classroom.update { it.copy(handText = null) }; send(HandSend(false)) }
    override suspend fun lowerHandOf(target: String) = send(HandLower(target))

    // ---- encuestas ----

    override suspend fun createPoll(question: String, options: List<String>, multi: Boolean, anonymous: Boolean, resultsOnClose: Boolean): String? {
        if (question.isBlank()) return "Escribe la pregunta"
        if (options.size !in 2..6) return "Pon entre 2 y 6 opciones"
        send(PollCreate(question.take(300), options.map { it.take(100) }, multi, anonymous, if (resultsOnClose) ShowResults.ON_CLOSE else ShowResults.LIVE))
        return null
    }
    override suspend fun vote(pollId: String, choices: List<Int>) {
        myVotes[pollId] = choices.sorted()
        _classroom.update { c -> c.copy(polls = c.polls[pollId]?.let { c.polls + (pollId to it.copy(myChoices = choices.sorted())) } ?: c.polls) }
        send(PollVote(pollId, choices.sorted()))
    }
    override suspend fun closePoll(pollId: String) = send(PollClose(pollId))

    // ---- vincular, diapositivas, laser y trazos ----

    override suspend fun pair(token: String): String? {
        if (conn == null) return "No estás en una reunión"
        send(PairClaim(token.take(32)))
        return null
    }
    override suspend fun unpair() = send(PairEnd)
    override suspend fun slide(action: SlideAction) = send(SlideSend(WSlide.valueOf(action.name)))
    override suspend fun pointer(x: Float, y: Float, on: Boolean) = send(PointerSend(x.coerceIn(0f, 1f).toDouble(), y.coerceIn(0f, 1f).toDouble(), on))
    override suspend fun ink(stroke: Int, points: List<Pair<Float, Float>>, color: InkColor, width: Int, tool: InkTool, done: Boolean) = send(
        InkSend(
            stroke, points.take(32).map { listOf(it.first.coerceIn(0f, 1f).toDouble(), it.second.coerceIn(0f, 1f).toDouble()) },
            WInkColor.valueOf(color.name), width.coerceIn(1, 3), WInkTool.valueOf(tool.name), done
        )
    )
    override suspend fun inkUndo() = send(InkUndo)
    override suspend fun inkClear() = send(InkClear)

    // ---- archivos ----

    /** Sube el archivo (oferta, trozos de 48 KB en orden) y despues publica el mensaje con el archivo. */
    override suspend fun sendFile(to: Audience, uri: Uri): String? = uploadLock.withLock {
        val c = conn ?: return "No estás en una reunión"
        val cr = context.contentResolver
        val (name, size) = withContext(Dispatchers.IO) {
            cr.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use {
                if (it.moveToFirst()) (it.getString(0) ?: "archivo") to it.getLong(1) else null
            }
        } ?: return "No se pudo leer el archivo"
        if (size <= 0) return "El archivo está vacío"
        if (size > FILE_MAX) return "El archivo pasa de 50 MB"
        val mime = cr.getType(uri) ?: MimeTypeMap.getSingleton().getMimeTypeFromExtension(name.substringAfterLast('.', "").lowercase()) ?: "application/octet-stream"
        val sha = withContext(Dispatchers.IO) {
            val md = MessageDigest.getInstance("SHA-256")
            cr.openInputStream(uri)?.use { input -> val buf = ByteArray(64 * 1024); while (true) { val n = input.read(buf); if (n < 0) break; md.update(buf, 0, n) } }
                ?: return@withContext null
            toHex(md.digest())
        } ?: return "No se pudo leer el archivo"

        val offer = CompletableDeferred<Result<Int>>()
        pendingOffer = offer
        c.send(FileOffer(name.replace(Regex("[/\\\\:\\p{Cntrl}]"), "_").take(200), size, sha, mime.take(100)))
        val id = (withTimeoutOrNull(15_000) { offer.await() } ?: Result.failure(IllegalStateException("El anfitrión no respondió")))
            .getOrElse { pendingOffer = null; return it.message }
        pendingOffer = null
        val key = id.toString()
        _classroom.update { it.copy(files = it.files + (key to SharedFile(key, name, size, mime, progress = 0f))) }
        val count = fileChunkCount(size)
        val ok = withContext(Dispatchers.IO) {
            cr.openInputStream(uri)?.use { input ->
                val buf = ByteArray(FILE_CHUNK)
                for (i in 0 until count) {
                    var read = 0
                    val want = if (i < count - 1) FILE_CHUNK else (size - FILE_CHUNK.toLong() * (count - 1)).toInt()
                    while (read < want) { val n = input.read(buf, read, want - read); if (n < 0) break; read += n }
                    if (read != want) return@use false
                    c.sendBinary(encodeFileChunk(id, i, count, buf.copyOf(want)))
                    val p = (i + 1f) / count
                    _classroom.update { st -> st.copy(files = st.files + (key to st.files.getValue(key).copy(progress = p))) }
                }
                true
            } ?: false
        }
        _classroom.update { st -> st.copy(files = st.files + (key to st.files.getValue(key).copy(progress = null, error = if (ok) null else "No se pudo enviar"))) }
        if (!ok) return "No se pudo leer el archivo"
        c.send(MsgSend(to.toWire(), MsgBody.File(id)))
        null
    }

    /** Pide el archivo, comprueba el SHA-256 y lo guarda en Descargas/MirrorStudio. Nunca lo abre solo. */
    override suspend fun download(fileId: String): String? {
        val c = conn ?: return "No estás en una reunión"
        val id = fileId.toIntOrNull() ?: return "Archivo no válido"
        if (downloads.containsKey(id)) return null
        val d = Download(CompletableDeferred())
        downloads[id] = d
        fun progress(p: Float?, error: String? = null, saved: Uri? = null) = _classroom.update { st ->
            st.files[fileId]?.let { st.copy(files = st.files + (fileId to it.copy(progress = p, error = error, savedTo = saved ?: it.savedTo))) } ?: st
        }
        try {
            progress(0f)
            c.send(FileGet(id))
            val meta = withTimeoutOrNull(30_000) { d.meta.await() } ?: run { progress(null, "El anfitrión no respondió"); return "El archivo no está disponible" }
            val count = fileChunkCount(meta.size)
            val tmp = File(context.cacheDir, "descarga-$id")
            val md = MessageDigest.getInstance("SHA-256")
            withContext(Dispatchers.IO) {
                FileOutputStream(tmp).use { out ->
                    for (i in 0 until count) {
                        val chunk = withTimeoutOrNull(60_000) { d.chunks.receive() } ?: error("se cortó")
                        if (chunk.index != i) error("desorden")
                        out.write(chunk.payload); md.update(chunk.payload)
                        progress((i + 1f) / count)
                    }
                }
            }
            if (toHex(md.digest()) != meta.sha256) { tmp.delete(); progress(null, "Llegó dañado; vuelve a descargarlo"); return "El archivo llegó dañado" }
            val saved = withContext(Dispatchers.IO) { saveToDownloads(tmp, meta.name, _classroom.value.files[fileId]?.mime) }
            tmp.delete()
            progress(null, saved = saved)
            return null
        } catch (e: Exception) {
            progress(null, "No se pudo descargar")
            return "No se pudo descargar el archivo"
        } finally {
            downloads.remove(id)
        }
    }

    private fun saveToDownloads(tmp: File, name: String, mime: String?): Uri {
        val type = mime ?: "application/octet-stream"
        if (Build.VERSION.SDK_INT >= 29) {
            val values = ContentValues().apply {
                put(MediaStore.Downloads.DISPLAY_NAME, name)
                put(MediaStore.Downloads.MIME_TYPE, type)
                put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/MirrorStudio")
            }
            val uri = context.contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: error("sin espacio")
            context.contentResolver.openOutputStream(uri)?.use { out -> tmp.inputStream().use { it.copyTo(out) } }
            return uri
        }
        val dir = File(context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "MirrorStudio").apply { mkdirs() }
        val dest = File(dir, name)
        tmp.copyTo(dest, overwrite = true)
        return FileProvider.getUriForFile(context, context.packageName + ".files", dest)
    }

    // ---- conversiones ----

    private fun Msg.toDomain(): ChatMessage {
        val who = from
        val (name, role) = when {
            who == null -> "Anónimo" to null
            else -> names[who] ?: (snapshot?.nameOf(who) ?: "Alguien que salió") to null
        }
        return ChatMessage(
            id = id, from = who ?: "", fromName = name, fromRole = role, at = at,
            to = when (val t = to) { MsgTo.All -> Audience.All; MsgTo.Teachers -> Audience.Teachers; is MsgTo.People -> Audience.People(t.ids) },
            body = when (val b = body) {
                is MsgBody.Text -> MessageBody.Text(b.text)
                is MsgBody.Question -> MessageBody.Question(b.text)
                is MsgBody.Link -> MessageBody.Link(b.url, b.title)
                is MsgBody.File -> MessageBody.File(b.fileId.toString())
                is MsgBody.Poll -> MessageBody.Poll(b.pollId)
            },
            mine = who == me, answered = answered == true, shown = shown == true
        )
    }

    private fun fileOf(m: Msg): Map<String, SharedFile> {
        val b = m.body as? MsgBody.File ?: return emptyMap()
        val key = b.fileId.toString()
        val old = _classroom.value.files[key]
        return mapOf(key to (old ?: SharedFile(key, b.name ?: "archivo", b.size ?: 0, b.mime)).copy(name = b.name ?: old?.name ?: "archivo", size = b.size ?: old?.size ?: 0, mime = b.mime ?: old?.mime))
    }

    private fun PollState.toDomain() = Poll(
        id = pollId, question = question, options = options, multi = multi, anonymous = anonymous, closed = closed,
        counts = counts, total = total, mine = snapshot?.myself?.role?.isStaff == true,
        myChoices = myVotes[pollId] ?: emptyList()
    )
}

private fun WAllow.toDomain() = when (this) { WAllow.ALL -> Allow.ALL; WAllow.TEACHERS -> Allow.TEACHERS; WAllow.OFF -> Allow.OFF }
private fun Allow.toWire() = when (this) { Allow.ALL -> WAllow.ALL; Allow.TEACHERS -> WAllow.TEACHERS; Allow.OFF -> WAllow.OFF }
private fun Audience.toWire(): MsgTo = when (this) { Audience.All -> MsgTo.All; Audience.Teachers -> MsgTo.Teachers; is Audience.People -> MsgTo.People(ids) }
