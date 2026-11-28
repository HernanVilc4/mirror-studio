package com.mirrorstudio.app.domain

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow

interface MeetingRepository {
    val status: StateFlow<SessionStatus>
    /** Avisos del anfitrion ("Solo el docente puede…") para mostrar como snackbar. */
    val notices: Flow<String>

    /** Devuelve null si entro, o el motivo para mostrar si no pudo. */
    suspend fun join(request: JoinRequest): String?
    /** Vuelve a entrar con los ultimos datos (tras perder la conexion). */
    suspend fun rejoin(): String?
    suspend fun leave()
    fun acknowledgeEnded()

    val extras: StateFlow<RoomExtras>
    fun setMuted(on: Boolean)
    /** Empieza a presentar la camara o la pantalla del telefono. [screenPermission] es el Intent de MediaProjection. */
    suspend fun present(source: PresentSource, screenPermission: android.content.Intent? = null, width: Int = 1280, height: Int = 720): String?
    suspend fun stopPresenting()
    fun switchCamera()

    suspend fun requestControl(target: String)
    suspend fun stopControl()
    /** «Reintentar el control»: la PC controlada reinicia su inyector y su captura. */
    suspend fun resetControl()
    suspend fun sendControl(input: com.mirrorstudio.protocol.ControlInput)
}

/** Ultimos datos usados para unirse, para no escribirlos cada clase. */
interface JoinPreferences {
    fun lastHost(): String
    fun lastPort(): Int
    fun lastName(): String
    fun saveName(name: String)
    fun save(request: JoinRequest)
    /** La ultima reunion a la que entre (con su codigo), para volver con un toque. Caduca a las 8 horas. */
    fun lastMeeting(): JoinRequest?
    fun forgetMeeting()
}
