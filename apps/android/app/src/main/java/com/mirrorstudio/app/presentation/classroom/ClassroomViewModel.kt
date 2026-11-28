package com.mirrorstudio.app.presentation.classroom

import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.mirrorstudio.app.domain.Audience
import com.mirrorstudio.app.domain.Classroom
import com.mirrorstudio.app.domain.ClassroomRepository
import com.mirrorstudio.app.domain.InkColor
import com.mirrorstudio.app.domain.InkTool
import com.mirrorstudio.app.domain.MeetingRepository
import com.mirrorstudio.app.domain.MeetingSnapshot
import com.mirrorstudio.app.domain.MessageBody
import com.mirrorstudio.app.domain.RoomSettings
import com.mirrorstudio.app.domain.SessionStatus
import com.mirrorstudio.app.domain.SlideAction
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

class ClassroomViewModel(
    private val repo: ClassroomRepository,
    meetings: MeetingRepository
) : ViewModel() {
    val classroom: StateFlow<Classroom> = repo.classroom
    val meeting: StateFlow<MeetingSnapshot?> = meetings.status.map {
        when (it) {
            is SessionStatus.InMeeting -> it.meeting
            is SessionStatus.Reconnecting -> it.meeting
            else -> null
        }
    }.stateIn(viewModelScope, SharingStarted.Eagerly, null)

    private val _errors = Channel<String>(Channel.BUFFERED)
    val errors: Flow<String> = _errors.receiveAsFlow()

    private fun run(block: suspend () -> String?) {
        viewModelScope.launch { block()?.let { _errors.send(it) } }
    }
    private fun fire(block: suspend () -> Unit) { viewModelScope.launch { block() } }

    fun markRead() = repo.markRead()
    fun sendText(to: Audience, text: String, question: Boolean) = run {
        repo.send(to, if (question) MessageBody.Question(text.trim()) else MessageBody.Text(text.trim()))
    }
    fun sendLink(to: Audience, url: String, title: String?) = run { repo.send(to, MessageBody.Link(url.trim(), title?.trim()?.ifBlank { null })) }
    fun sendFile(to: Audience, uri: Uri) = run { repo.sendFile(to, uri) }
    fun download(fileId: String) = run { repo.download(fileId) }
    fun delete(id: String) = fire { repo.deleteMessage(id) }
    fun markAnswered(id: String, on: Boolean) = fire { repo.markAnswered(id, on) }
    fun showToAll(id: String, anonymous: Boolean) = fire { repo.showToAll(id, anonymous) }
    fun mute(target: String, on: Boolean) = fire { repo.muteChat(target, on) }
    fun setSettings(s: RoomSettings) = fire { repo.setSettings(s) }

    fun raiseHand(text: String?) = fire { repo.raiseHand(text?.trim()?.ifBlank { null }) }
    fun lowerHand() = fire { repo.lowerHand() }
    fun lowerHandOf(id: String) = fire { repo.lowerHandOf(id) }

    fun createPoll(q: String, options: List<String>, multi: Boolean, anonymous: Boolean, onClose: Boolean) =
        run { repo.createPoll(q.trim(), options.map { it.trim() }.filter { it.isNotEmpty() }, multi, anonymous, onClose) }
    fun vote(id: String, choices: List<Int>) = fire { repo.vote(id, choices) }
    fun closePoll(id: String) = fire { repo.closePoll(id) }

    fun pair(token: String) = run { repo.pair(token) }
    fun unpair() = fire { repo.unpair() }
    fun slide(a: SlideAction) = fire { repo.slide(a) }
    fun pointer(x: Float, y: Float, on: Boolean) = fire { repo.pointer(x, y, on) }
    fun ink(stroke: Int, points: List<Pair<Float, Float>>, color: InkColor, width: Int, tool: InkTool, done: Boolean) =
        fire { repo.ink(stroke, points, color, width, tool, done) }
    fun inkUndo() = fire { repo.inkUndo() }
    fun inkClear() = fire { repo.inkClear() }
}
