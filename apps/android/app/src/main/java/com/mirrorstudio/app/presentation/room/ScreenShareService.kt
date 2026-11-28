package com.mirrorstudio.app.presentation.room

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import com.mirrorstudio.app.MainActivity
import com.mirrorstudio.app.R

/**
 * Android exige un servicio en primer plano de tipo «proyeccion de medios» mientras se comparte la pantalla.
 * Solo muestra la notificacion «Estás presentando tu pantalla»; la captura la hace WebRTC.
 */
class ScreenShareService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val nm = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= 26) nm.createNotificationChannel(NotificationChannel(CHANNEL, "Presentar", NotificationManager.IMPORTANCE_LOW))
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        val n = Notification.Builder(this, CHANNEL)
            .setContentTitle("Estás presentando tu pantalla")
            .setContentText("Toda la sala la ve. Toca para volver a MirrorStudio.")
            .setSmallIcon(R.drawable.ic_stat_present)
            .setContentIntent(open)
            .setOngoing(true)
            .build()
        if (Build.VERSION.SDK_INT >= 29) startForeground(ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION) else startForeground(ID, n)
        return START_NOT_STICKY
    }

    companion object {
        private const val CHANNEL = "presentar"
        private const val ID = 7

        fun start(context: Context) {
            val i = Intent(context, ScreenShareService::class.java)
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(i) else context.startService(i)
        }

        fun stop(context: Context) { context.stopService(Intent(context, ScreenShareService::class.java)) }
    }
}
