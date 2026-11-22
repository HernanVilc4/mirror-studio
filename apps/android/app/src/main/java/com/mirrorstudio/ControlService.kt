package com.mirrorstudio

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.view.accessibility.AccessibilityEvent

/**
 * Executes remote input ONLY while the user has manually enabled this service in Android settings.
 * Disabling it there revokes control immediately. It never reads screen content (no event types requested).
 */
class ControlService : AccessibilityService() {
    companion object {
        @Volatile var instance: ControlService? = null
        val enabled get() = instance != null
        /** Last gesture outcome, shown in the app so failures are visible instead of silent. */
        val last = kotlinx.coroutines.flow.MutableStateFlow("—")
    }

    private var downX = 0f; private var downY = 0f; private var downAt = 0L

    override fun onServiceConnected() { instance = this }
    override fun onUnbind(intent: android.content.Intent?): Boolean { instance = null; return super.onUnbind(intent) }
    override fun onAccessibilityEvent(e: AccessibilityEvent?) {}
    override fun onInterrupt() {}

    /** x,y in screen pixels. A press is replayed as one gesture on release, so long-press and swipe keep their timing. */
    private fun run(g: GestureDescription) {
        val cb = object : GestureResultCallback() {
            override fun onCompleted(d: GestureDescription?) { last.value = "gesto completado" }
            override fun onCancelled(d: GestureDescription?) { last.value = "gesto cancelado por Android" }
        }
        last.value = if (dispatchGesture(g, cb, null)) "gesto enviado…" else "Android rechazó el gesto"
    }

    /** x,y in screen pixels. A press is replayed as one gesture on release, so long-press and swipe keep their timing. */
    fun pointer(action: String, x: Float, y: Float) {
        when (action) {
            "down" -> { downX = x; downY = y; downAt = System.currentTimeMillis() }
            "up" -> {
                val dur = (System.currentTimeMillis() - downAt).coerceIn(50, 5000)
                val p = Path().apply { moveTo(downX, downY); if (x != downX || y != downY) lineTo(x, y) }
                run(GestureDescription.Builder().addStroke(GestureDescription.StrokeDescription(p, 0, dur)).build())
            }
        }
    }

    fun scroll(x: Float, y: Float, dx: Float, dy: Float, w: Int, h: Int) {
        val p = Path().apply { moveTo(x, y); lineTo((x + dx * w * 0.3f).coerceIn(0f, w - 1f), (y + dy * h * 0.3f).coerceIn(0f, h - 1f)) }
        run(GestureDescription.Builder().addStroke(GestureDescription.StrokeDescription(p, 0, 250)).build())
    }

    fun key(k: String) {
        performGlobalAction(when (k) {
            "back" -> GLOBAL_ACTION_BACK
            "home" -> GLOBAL_ACTION_HOME
            "recents" -> GLOBAL_ACTION_RECENTS
            else -> return
        })
    }
}
