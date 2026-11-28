package com.mirrorstudio.app.data

import android.content.Context
import android.os.Build
import android.provider.Settings
import com.mirrorstudio.app.domain.JoinPreferences
import com.mirrorstudio.app.domain.JoinRequest
import com.mirrorstudio.protocol.DEFAULT_PORT

/** Guarda IP, puerto y nombre (nunca el codigo: cambia en cada reunion). */
class SharedJoinPreferences(private val context: Context) : JoinPreferences {
    private val prefs = context.getSharedPreferences("join", Context.MODE_PRIVATE)

    override fun lastHost(): String = prefs.getString("host", "") ?: ""
    override fun lastPort(): Int = prefs.getInt("port", DEFAULT_PORT)
    override fun lastName(): String = prefs.getString("name", null) ?: deviceName()

    override fun saveName(name: String) {
        if (name.isNotBlank()) prefs.edit().putString("name", name.trim()).apply()
    }

    override fun save(request: JoinRequest) {
        prefs.edit().putString("host", request.host).putInt("port", request.port).putString("name", request.name)
            .putString("lastCode", request.code).putLong("lastAt", System.currentTimeMillis()).apply()
    }

    override fun lastMeeting(): JoinRequest? {
        val code = prefs.getString("lastCode", null) ?: return null
        val at = prefs.getLong("lastAt", 0)
        if (System.currentTimeMillis() - at > 8 * 60 * 60 * 1000L) { forgetMeeting(); return null }
        val host = prefs.getString("host", null)?.takeIf { it.isNotBlank() } ?: return null
        return JoinRequest(host, prefs.getInt("port", DEFAULT_PORT), code, lastName())
    }

    override fun forgetMeeting() { prefs.edit().remove("lastCode").remove("lastAt").apply() }

    private fun deviceName(): String =
        runCatching { Settings.Global.getString(context.contentResolver, Settings.Global.DEVICE_NAME) }.getOrNull()
            ?.takeIf { it.isNotBlank() } ?: Build.MODEL
}
