package com.mirrorstudio.app.presentation.room

import android.content.Intent
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.mirrorstudio.app.data.KtorMeetingRepository
import com.mirrorstudio.app.domain.MeetingSnapshot
import com.mirrorstudio.app.domain.PresentSource
import com.mirrorstudio.app.domain.RoomExtras
import com.mirrorstudio.app.domain.SessionStatus
import com.mirrorstudio.protocol.ControlInput
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.merge
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import org.webrtc.VideoTrack

data class RoomUi(
    val meeting: MeetingSnapshot? = null,
    /** Intento de reconexion en curso (pantalla 14), o null. */
    val reconnect: Pair<Int, Int>? = null,
    val extras: RoomExtras = RoomExtras()
)

@OptIn(ExperimentalCoroutinesApi::class)
class RoomViewModel(private val repository: KtorMeetingRepository) : ViewModel() {

    val ui: StateFlow<RoomUi> = combine(repository.status, repository.extras) { st, ex ->
        when (st) {
            is SessionStatus.InMeeting -> RoomUi(st.meeting, null, ex)
            is SessionStatus.Reconnecting -> RoomUi(st.meeting, st.attempt to st.max, ex)
            else -> RoomUi(null, null, ex)
        }
    }.stateIn(viewModelScope, SharingStarted.Eagerly, RoomUi())

    val egl get() = repository.egl
    val presentation: StateFlow<VideoTrack?> = repository.link.flatMapLatest { it?.presentation ?: flowOf(null) }
        .stateIn(viewModelScope, SharingStarted.Eagerly, null)
    val control: StateFlow<VideoTrack?> = repository.link.flatMapLatest { it?.control ?: flowOf(null) }
        .stateIn(viewModelScope, SharingStarted.Eagerly, null)
    val local: StateFlow<VideoTrack?> = repository.link.flatMapLatest { it?.local ?: flowOf(null) }
        .stateIn(viewModelScope, SharingStarted.Eagerly, null)

    private val errors = Channel<String>(Channel.BUFFERED)
    val messages: Flow<String> = merge(repository.notices, errors.receiveAsFlow())

    fun leave() { viewModelScope.launch { repository.leave() } }
    fun leaveAndRejoin() { viewModelScope.launch { repository.reconnectMedia() } }
    fun kick(target: String) { viewModelScope.launch { repository.kick(target) } }
    fun setRole(target: String, teacher: Boolean) { viewModelScope.launch { repository.setRole(target, teacher) } }
    fun setMuted(on: Boolean) = repository.setMuted(on)

    fun presentCamera() { viewModelScope.launch { repository.present(PresentSource.CAMERA)?.let { errors.send(it) } } }
    fun presentScreen(permission: Intent, w: Int, h: Int) {
        viewModelScope.launch { repository.present(PresentSource.SCREEN, permission, w, h)?.let { errors.send(it) } }
    }
    fun stopPresenting() { viewModelScope.launch { repository.stopPresenting() } }
    fun switchCamera() = repository.switchCamera()

    fun requestControl(target: String) { viewModelScope.launch { repository.requestControl(target) } }
    fun stopControl() { viewModelScope.launch { repository.stopControl() } }
    fun resetControl() { viewModelScope.launch { repository.resetControl() } }
    fun send(input: ControlInput) { viewModelScope.launch { repository.sendControl(input) } }

    /**
     * «Tocar la imagen»: lleva el puntero al punto tocado y recien despues hace clic. Si el movimiento y el clic salen
     * juntos, Windows toma el clic antes de que el puntero llegue y solo se ve moverse el cursor.
     */
    fun tapAt(x: Float, y: Float, button: com.mirrorstudio.protocol.MouseButtonKind) {
        viewModelScope.launch {
            repository.sendControl(com.mirrorstudio.protocol.MouseMove(x.toDouble(), y.toDouble()))
            kotlinx.coroutines.delay(60)
            repository.sendControl(com.mirrorstudio.protocol.MouseButton(button, true))
            kotlinx.coroutines.delay(40)
            repository.sendControl(com.mirrorstudio.protocol.MouseButton(button, false))
        }
    }
}
