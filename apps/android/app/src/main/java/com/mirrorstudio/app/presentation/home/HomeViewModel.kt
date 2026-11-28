package com.mirrorstudio.app.presentation.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.mirrorstudio.app.domain.DiscoveryRepository
import com.mirrorstudio.app.domain.JoinMeetingUseCase
import com.mirrorstudio.app.domain.JoinPreferences
import com.mirrorstudio.app.domain.NearbyMeeting
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** La reunion a la que entraste hace poco y que sigue abierta. */
data class ResumeOffer(val name: String, val host: String, val people: Int, val compatible: Boolean)

data class HomeUiState(
    val name: String = "",
    val searching: Boolean = false,
    val searchedOnce: Boolean = false,
    val nearby: List<NearbyMeeting> = emptyList(),
    val resume: ResumeOffer? = null,
    val resuming: Boolean = false,
    val resumeError: String? = null
)

class HomeViewModel(
    private val discovery: DiscoveryRepository,
    private val preferences: JoinPreferences,
    private val join: JoinMeetingUseCase
) : ViewModel() {
    private val _state = MutableStateFlow(HomeUiState(name = preferences.lastName()))
    val state: StateFlow<HomeUiState> = _state.asStateFlow()
    private var search: Job? = null

    init { refresh() }

    fun onName(v: String) {
        val n = v.take(64)
        _state.update { it.copy(name = n) }
        preferences.saveName(n)
    }

    fun refresh() {
        checkResume()
        if (search?.isActive == true) return
        _state.update { it.copy(searching = true) }
        search = viewModelScope.launch {
            val found = runCatching { discovery.scan() }.getOrDefault(emptyList())
            _state.update { it.copy(searching = false, searchedOnce = true, nearby = found) }
        }
    }

    /** Solo se ofrece volver si la PC sigue respondiendo: si el docente cerro la reunion, se olvida. */
    private fun checkResume() {
        val last = preferences.lastMeeting() ?: return _state.update { it.copy(resume = null) }
        viewModelScope.launch {
            val info = runCatching { discovery.probe(last.host, last.port) }.getOrNull()
            if (info == null) _state.update { it.copy(resume = null) }
            else _state.update { it.copy(resume = ResumeOffer(info.name, last.host, info.participants, info.compatible)) }
        }
    }

    fun resume() {
        val last = preferences.lastMeeting() ?: return
        if (_state.value.resuming) return
        _state.update { it.copy(resuming = true, resumeError = null) }
        viewModelScope.launch {
            val r = join(last.host, last.port.toString(), last.code, _state.value.name.ifBlank { last.name })
            _state.update {
                when (r) {
                    JoinMeetingUseCase.Result.Joined -> it.copy(resuming = false)
                    is JoinMeetingUseCase.Result.Failed -> { preferences.forgetMeeting(); it.copy(resuming = false, resume = null, resumeError = r.message) }
                    is JoinMeetingUseCase.Result.Invalid -> { preferences.forgetMeeting(); it.copy(resuming = false, resume = null, resumeError = r.message) }
                }
            }
        }
    }
}
