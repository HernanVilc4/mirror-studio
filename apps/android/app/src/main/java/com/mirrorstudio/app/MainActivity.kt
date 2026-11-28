package com.mirrorstudio.app

import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import com.mirrorstudio.app.domain.MeetingLink
import com.mirrorstudio.app.presentation.MirrorStudioRoot
import kotlinx.coroutines.flow.MutableStateFlow

class MainActivity : ComponentActivity() {
    private val links = MutableStateFlow<MeetingLink?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        // Modo claro fijo (como el prototipo): iconos oscuros en las barras del sistema.
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT)
        )
        super.onCreate(savedInstanceState)
        if (savedInstanceState == null) handle(intent)
        setContent { MirrorStudioRoot(links, consumeLink = { links.value = null }) }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handle(intent)
    }

    /** `mirrorstudio://join?…` desde WhatsApp, el aula virtual o la camara del telefono. */
    private fun handle(intent: Intent?) {
        val data = intent?.takeIf { it.action == Intent.ACTION_VIEW }?.dataString ?: return
        MeetingLink.parse(data)?.let { links.value = it }
    }
}
