package com.mirrorstudio

import android.app.*
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.IBinder
import kotlinx.coroutines.flow.MutableStateFlow
import okhttp3.*
import org.json.JSONObject
import org.webrtc.*
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * Foreground service that owns the MediaProjection and the WebRTC sender.
 * Protocol: docs/protocol.md. Android is the OFFERER; the desktop answers.
 */
class CaptureService : Service() {
    companion object {
        val status = MutableStateFlow("Listo")
        val controlEvents = MutableStateFlow(0)
    }

    private var projection: MediaProjection? = null
    private var ws: WebSocket? = null
    private var factory: PeerConnectionFactory? = null
    private var pc: PeerConnection? = null
    private var capturer: ScreenCapturerAndroid? = null
    private var token = ""

    override fun onBind(i: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent == null) return START_NOT_STICKY
        startForegroundNotification()
        val data = intent.getParcelableExtra<Intent>("data")!!
        token = intent.getStringExtra("token").orEmpty()
        startWebRtc(data)
        connect(intent.getStringExtra("host")!!, intent.getIntExtra("port", 47800))
        return START_NOT_STICKY
    }

    private fun startForegroundNotification() {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel("cap", "Retransmisión", NotificationManager.IMPORTANCE_LOW))
        val n = Notification.Builder(this, "cap").setContentTitle("Mirror Studio")
            .setContentText("Compartiendo pantalla con tu equipo").setSmallIcon(android.R.drawable.ic_menu_share).setOngoing(true).build()
        if (Build.VERSION.SDK_INT >= 29) startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION) else startForeground(1, n)
    }

    private fun startWebRtc(permission: Intent) {
        PeerConnectionFactory.initialize(PeerConnectionFactory.InitializationOptions.builder(this).createInitializationOptions())
        val egl = EglBase.create()
        factory = PeerConnectionFactory.builder()
            .setVideoEncoderFactory(DefaultVideoEncoderFactory(egl.eglBaseContext, true, true))
            .setVideoDecoderFactory(DefaultVideoDecoderFactory(egl.eglBaseContext)).createPeerConnectionFactory()
        capturer = ScreenCapturerAndroid(permission, object : MediaProjection.Callback() {
            override fun onStop() { status.value = "Captura detenida"; stopSelf() }
        })
        val source = factory!!.createVideoSource(true)
        val helper = SurfaceTextureHelper.create("capture", egl.eglBaseContext)
        capturer!!.initialize(helper, this, source.capturerObserver)
        val dm = resources.displayMetrics
        // 720p-class, 30 fps. Keeps aspect ratio of the real screen.
        val scale = 720f / minOf(dm.widthPixels, dm.heightPixels)
        controlEvents.value = 0
        capturer!!.startCapture((dm.widthPixels * scale).toInt() and 1.inv(), (dm.heightPixels * scale).toInt() and 1.inv(), 30)
        val track = factory!!.createVideoTrack("screen", source)

        pc = factory!!.createPeerConnection(PeerConnection.RTCConfiguration(emptyList()), object : PeerConnection.Observer {
            override fun onIceCandidate(c: IceCandidate) = send(JSONObject().put("t", "ice").put("candidate", c.sdp).put("sdpMid", c.sdpMid).put("sdpMLineIndex", c.sdpMLineIndex))
            override fun onConnectionChange(s: PeerConnection.PeerConnectionState) {
                status.value = when (s) { PeerConnection.PeerConnectionState.CONNECTED -> "Transmitiendo"; PeerConnection.PeerConnectionState.FAILED -> "Conexión perdida"; else -> status.value }
            }
            override fun onSignalingChange(s: PeerConnection.SignalingState) {}
            override fun onIceConnectionChange(s: PeerConnection.IceConnectionState) {}
            override fun onIceConnectionReceivingChange(b: Boolean) {}
            override fun onIceGatheringChange(s: PeerConnection.IceGatheringState) {}
            override fun onIceCandidatesRemoved(c: Array<out IceCandidate>) {}
            override fun onAddStream(s: MediaStream) {}
            override fun onRemoveStream(s: MediaStream) {}
            override fun onDataChannel(d: DataChannel) {}
            override fun onRenegotiationNeeded() {}
            override fun onAddTrack(r: RtpReceiver, s: Array<out MediaStream>) {}
        })
        pc!!.addTrack(track, listOf("stream"))
        val dc = pc!!.createDataChannel("control", DataChannel.Init())
        dc.registerObserver(object : DataChannel.Observer {
            override fun onBufferedAmountChange(p: Long) {}
            override fun onStateChange() {
                if (dc.state() == DataChannel.State.OPEN) tick(dc)
            }
            override fun onMessage(b: DataChannel.Buffer) {
                if (b.binary || b.data.remaining() > 4096) return
                val bytes = ByteArray(b.data.remaining()).also { b.data.get(it) }
                main.post { runCatching { handleControl(JSONObject(String(bytes)), dc) }.onFailure { android.util.Log.e("MirrorControl", "control failed", it) } }
            }
        })
    }

    // Re-reports every 2s so the desktop notices when accessibility is enabled/revoked or the screen rotates.
    private val main = android.os.Handler(android.os.Looper.getMainLooper())
    private fun tick(dc: DataChannel) {
        if (dc.state() != DataChannel.State.OPEN) return
        sendInfo(dc); main.postDelayed({ tick(dc) }, 2000)
    }

    private fun screen() = resources.displayMetrics

    /** Tells the desktop the real screen size and whether control is actually possible right now. */
    private fun sendInfo(dc: DataChannel) {
        val d = screen()
        val rot = (getSystemService(android.view.WindowManager::class.java).defaultDisplay.rotation) * 90
        val j = JSONObject().put("t", "info").put("width", d.widthPixels).put("height", d.heightPixels)
            .put("rotation", rot).put("controlEnabled", ControlService.enabled)
        dc.send(DataChannel.Buffer(java.nio.ByteBuffer.wrap(j.toString().toByteArray()), false))
    }

    private fun handleControl(m: JSONObject, dc: DataChannel) {
        val svc = ControlService.instance ?: return sendInfo(dc) // not enabled: report real state, do nothing
        val d = screen(); val w = d.widthPixels; val h = d.heightPixels
        val x = m.optDouble("x", 0.0).toFloat().coerceIn(0f, 1f) * (w - 1)
        val y = m.optDouble("y", 0.0).toFloat().coerceIn(0f, 1f) * (h - 1)
        controlEvents.value++
        when (m.getString("t")) {
            "pointer" -> svc.pointer(m.getString("action"), x, y)
            "scroll" -> svc.scroll(x, y, m.optDouble("dx").toFloat(), m.optDouble("dy").toFloat(), w, h)
            "key" -> svc.key(m.getString("key"))
        }
    }

    private fun connect(host: String, port: Int) {
        status.value = "Esperando aprobación en el equipo…"
        ws = OkHttpClient().newWebSocket(Request.Builder().url("ws://$host:$port").build(), object : WebSocketListener() {
            override fun onOpen(w: WebSocket, r: Response) = send(JSONObject().put("t", "hello").put("v", 1).apply { if (token.isNotEmpty()) put("token", token) }
                .put("deviceId", Build.ID).put("name", Build.MODEL).put("model", "${Build.MANUFACTURER} ${Build.MODEL}"))
            override fun onMessage(w: WebSocket, text: String) {
                val m = JSONObject(text)
                when (m.getString("t")) {
                    "hello-ack" -> when (m.getString("status")) {
                        "approved" -> makeOffer()
                        "rejected" -> { status.value = m.optString("reason", "Rechazado"); stopSelf() }
                    }
                    "answer" -> {
                        val sdp = m.getString("sdp")
                        if (hmac(sdp) != m.getString("sig")) { status.value = "Firma inválida"; stopSelf(); return }
                        pc?.setRemoteDescription(NoOp(), SessionDescription(SessionDescription.Type.ANSWER, sdp))
                    }
                    "ice" -> pc?.addIceCandidate(IceCandidate(m.optString("sdpMid"), m.optInt("sdpMLineIndex"), m.getString("candidate")))
                    "bye" -> stopSelf()
                }
            }
            override fun onFailure(w: WebSocket, t: Throwable, r: Response?) { status.value = "Conexión perdida: ${t.message}"; stopSelf() }
        })
    }

    private fun makeOffer() {
        pc!!.createOffer(object : NoOp() {
            override fun onCreateSuccess(d: SessionDescription) {
                pc!!.setLocalDescription(NoOp(), d)
                send(JSONObject().put("t", "offer").put("sdp", d.description).put("sig", hmac(d.description)))
            }
        }, MediaConstraints())
    }

    private fun hmac(s: String): String {
        val mac = Mac.getInstance("HmacSHA256").apply { init(SecretKeySpec((token.ifEmpty { "open" }).toByteArray(), "HmacSHA256")) }
        return mac.doFinal(s.toByteArray()).joinToString("") { "%02x".format(it) }
    }

    private fun send(o: JSONObject) { ws?.send(o.toString()) }

    override fun onDestroy() {
        ws?.send("""{"t":"bye"}"""); ws?.close(1000, null)
        runCatching { capturer?.stopCapture() }; capturer?.dispose()
        pc?.close(); factory?.dispose()
        if (status.value == "Transmitiendo") status.value = "Sesión finalizada"
        super.onDestroy()
    }

    private open class NoOp : SdpObserver {
        override fun onCreateSuccess(d: SessionDescription) {}
        override fun onSetSuccess() {}
        override fun onCreateFailure(e: String?) {}
        override fun onSetFailure(e: String?) {}
    }
}
