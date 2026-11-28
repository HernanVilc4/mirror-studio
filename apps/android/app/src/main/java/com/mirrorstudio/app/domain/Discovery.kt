package com.mirrorstudio.app.domain

data class NearbyMeeting(
    val ip: String,
    val port: Int,
    val name: String,
    val hostName: String,
    val participants: Int,
    /** false si la PC tiene otra version de MirrorStudio: se muestra, pero no se puede entrar. */
    val compatible: Boolean
)

interface DiscoveryRepository {
    /** Reuniones en las redes locales del telefono (Wi-Fi o su propio punto de acceso). */
    suspend fun scan(): List<NearbyMeeting>
    /** Pregunta a una PC concreta (nombre, anfitrion, personas). Null si no responde. */
    suspend fun probe(ip: String, port: Int): NearbyMeeting?
}
