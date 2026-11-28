package com.mirrorstudio.app.data.media

import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjection
import com.mirrorstudio.protocol.RtcKind
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.suspendCancellableCoroutine
import org.json.JSONObject
import org.webrtc.AudioTrack
import org.webrtc.Camera2Enumerator
import org.webrtc.CameraVideoCapturer
import org.webrtc.DataChannel
import org.webrtc.DefaultVideoDecoderFactory
import org.webrtc.DefaultVideoEncoderFactory
import org.webrtc.EglBase
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.MediaStream
import org.webrtc.MediaStreamTrack
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.RtpReceiver
import org.webrtc.RtpTransceiver
import org.webrtc.ScreenCapturerAndroid
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import org.webrtc.SurfaceTextureHelper
import org.webrtc.VideoCapturer
import org.webrtc.VideoSource
import org.webrtc.VideoTrack
import org.webrtc.audio.JavaAudioDeviceModule
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/** Una fabrica WebRTC por app: decodificador por hardware (H.264 en casi todos los telefonos) y EGL compartido. */
class RtcMedia(private val context: Context) {
    val egl: EglBase by lazy { EglBase.create() }
    private val factory: PeerConnectionFactory by lazy {
        PeerConnectionFactory.initialize(PeerConnectionFactory.InitializationOptions.builder(context).createInitializationOptions())
        PeerConnectionFactory.builder()
            .setVideoDecoderFactory(DefaultVideoDecoderFactory(egl.eglBaseContext))
            .setVideoEncoderFactory(DefaultVideoEncoderFactory(egl.eglBaseContext, true, true))
            .setAudioDeviceModule(JavaAudioDeviceModule.builder(context).createAudioDeviceModule())
            .createPeerConnectionFactory()
    }

    fun open(signal: (RtcKind, String) -> Unit): RtcLink = RtcLink(context, factory, egl, signal)
}

enum class LinkState { CONNECTING, CONNECTED, FAILED, CLOSED }

/** Que envia el telefono por el transceptor `screen`. */
enum class Sending { NOTHING, CAMERA, SCREEN }

/** `RTCIceCandidateInit` del navegador: `{candidate, sdpMid, sdpMLineIndex}`. */
private fun encodeIce(c: IceCandidate): String =
    JSONObject().put("candidate", c.sdp).put("sdpMid", c.sdpMid).put("sdpMLineIndex", c.sdpMLineIndex).toString()

private fun decodeIce(data: String): IceCandidate? = runCatching {
    val o = JSONObject(data)
    IceCandidate(o.optString("sdpMid", ""), o.optInt("sdpMLineIndex", 0), o.getString("candidate"))
}.getOrNull()

/**
 * El enlace telefono <-> centro de medios del anfitrion. Igual que `Guest` del escritorio (media.ts): el
 * invitado ofrece cuatro transceptores en este orden — audio (sendrecv), presentacion (recvonly), PC
 * controlada (recvonly) y lo que yo comparto (sendonly) — y el anfitrion responde. Solo red local: sin STUN.
 */
class RtcLink internal constructor(
    private val context: Context,
    private val factory: PeerConnectionFactory,
    private val egl: EglBase,
    private val signal: (RtcKind, String) -> Unit
) {
    private val _presentation = MutableStateFlow<VideoTrack?>(null)
    val presentation: StateFlow<VideoTrack?> = _presentation.asStateFlow()
    private val _control = MutableStateFlow<VideoTrack?>(null)
    val control: StateFlow<VideoTrack?> = _control.asStateFlow()
    private val _state = MutableStateFlow(LinkState.CONNECTING)
    val state: StateFlow<LinkState> = _state.asStateFlow()
    private val _sending = MutableStateFlow(Sending.NOTHING)
    val sending: StateFlow<Sending> = _sending.asStateFlow()
    /** Lo que muestra mi propia vista previa mientras comparto. */
    private val _local = MutableStateFlow<VideoTrack?>(null)
    val local: StateFlow<VideoTrack?> = _local.asStateFlow()

    private var remoteAudio: AudioTrack? = null
    private var muted = false
    private val pendingIce = mutableListOf<IceCandidate>()
    private var remoteSet = false
    private var closed = false

    private val pc: PeerConnection = factory.createPeerConnection(
        PeerConnection.RTCConfiguration(emptyList()).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
            bundlePolicy = PeerConnection.BundlePolicy.MAXBUNDLE
        },
        object : PeerConnection.Observer {
            override fun onIceCandidate(c: IceCandidate) {
                signal(RtcKind.ICE, encodeIce(c))
            }
            override fun onConnectionChange(s: PeerConnection.PeerConnectionState) {
                if (closed) return
                _state.value = when (s) {
                    PeerConnection.PeerConnectionState.CONNECTED -> LinkState.CONNECTED
                    PeerConnection.PeerConnectionState.FAILED -> LinkState.FAILED
                    PeerConnection.PeerConnectionState.CLOSED -> LinkState.CLOSED
                    else -> if (_state.value == LinkState.CONNECTED && s == PeerConnection.PeerConnectionState.DISCONNECTED) LinkState.CONNECTING else _state.value
                }
            }
            override fun onTrack(t: RtpTransceiver) {
                val track = t.receiver.track() ?: return
                when (t.mid) {
                    audio.mid -> { remoteAudio = track as? AudioTrack; remoteAudio?.setEnabled(!muted) }
                    present.mid -> _presentation.value = track as? VideoTrack
                    controlT.mid -> _control.value = track as? VideoTrack
                }
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
        }
    ) ?: error("No se pudo crear la conexión de video")

    private val audio = pc.addTransceiver(MediaStreamTrack.MediaType.MEDIA_TYPE_AUDIO, RtpTransceiver.RtpTransceiverInit(RtpTransceiver.RtpTransceiverDirection.SEND_RECV))
    private val present = pc.addTransceiver(MediaStreamTrack.MediaType.MEDIA_TYPE_VIDEO, RtpTransceiver.RtpTransceiverInit(RtpTransceiver.RtpTransceiverDirection.RECV_ONLY))
    private val controlT = pc.addTransceiver(MediaStreamTrack.MediaType.MEDIA_TYPE_VIDEO, RtpTransceiver.RtpTransceiverInit(RtpTransceiver.RtpTransceiverDirection.RECV_ONLY))
    private val screen = pc.addTransceiver(MediaStreamTrack.MediaType.MEDIA_TYPE_VIDEO, RtpTransceiver.RtpTransceiverInit(RtpTransceiver.RtpTransceiverDirection.SEND_ONLY))

    private var capturer: VideoCapturer? = null
    private var source: VideoSource? = null
    private var helper: SurfaceTextureHelper? = null
    private var sendTrack: VideoTrack? = null

    suspend fun start() {
        val offer = sdp { pc.createOffer(it, MediaConstraints()) }
        unit { pc.setLocalDescription(it, offer) }
        signal(RtcKind.OFFER, offer.description)
    }

    suspend fun onSignal(kind: RtcKind, data: String) {
        if (closed) return
        when (kind) {
            RtcKind.ANSWER -> {
                unit { pc.setRemoteDescription(it, SessionDescription(SessionDescription.Type.ANSWER, data)) }
                remoteSet = true
                pendingIce.forEach { pc.addIceCandidate(it) }
                pendingIce.clear()
            }
            RtcKind.ICE -> {
                val ice = decodeIce(data) ?: return
                if (remoteSet) pc.addIceCandidate(ice) else pendingIce.add(ice)
            }
            RtcKind.OFFER -> Unit // el anfitrion nunca ofrece
        }
    }

    /** Silencia el sonido de la PC que presenta (solo en este telefono). */
    fun setMuted(on: Boolean) {
        muted = on
        remoteAudio?.setEnabled(!on)
    }

    /** Camara de documentos: la camara trasera va por el transceptor `screen` (pantalla 20). */
    fun startCamera(front: Boolean = false): Boolean {
        stopSending()
        val enumerator = Camera2Enumerator(context)
        val name = enumerator.deviceNames.firstOrNull { enumerator.isFrontFacing(it) == front } ?: enumerator.deviceNames.firstOrNull() ?: return false
        val cam = enumerator.createCapturer(name, null) ?: return false
        begin(cam, 1920, 1080, 30, screencast = false)
        _sending.value = Sending.CAMERA
        return true
    }

    fun switchCamera() { (capturer as? CameraVideoCapturer)?.switchCamera(null) }

    /** Compartir la pantalla del telefono (pantallas 10 a 12). [permission] es el resultado de MediaProjection. */
    fun startScreen(permission: Intent, width: Int, height: Int, onStopped: () -> Unit) {
        stopSending()
        val cap = ScreenCapturerAndroid(permission, object : MediaProjection.Callback() {
            override fun onStop() { onStopped() }
        })
        begin(cap, width, height, 15, screencast = true)
        _sending.value = Sending.SCREEN
    }

    private fun begin(cap: VideoCapturer, w: Int, h: Int, fps: Int, screencast: Boolean) {
        val th = SurfaceTextureHelper.create("captura", egl.eglBaseContext)
        val src = factory.createVideoSource(screencast)
        cap.initialize(th, context, src.capturerObserver)
        cap.startCapture(w, h, fps)
        val track = factory.createVideoTrack("screen", src)
        screen.sender.setTrack(track, false)
        screen.sender.parameters = screen.sender.parameters.apply {
            degradationPreference = if (screencast) org.webrtc.RtpParameters.DegradationPreference.MAINTAIN_RESOLUTION else org.webrtc.RtpParameters.DegradationPreference.BALANCED
            encodings.firstOrNull()?.let { it.maxBitrateBps = if (screencast) 2_500_000 else 3_000_000; it.maxFramerate = fps }
        }
        capturer = cap; source = src; helper = th; sendTrack = track
        _local.value = track
    }

    fun stopSending() {
        screen.sender.setTrack(null, false)
        _local.value = null
        runCatching { capturer?.stopCapture() }
        capturer?.dispose(); capturer = null
        sendTrack?.dispose(); sendTrack = null
        source?.dispose(); source = null
        helper?.dispose(); helper = null
        _sending.value = Sending.NOTHING
    }

    fun close() {
        if (closed) return
        closed = true
        stopSending()
        _presentation.value = null
        _control.value = null
        _state.value = LinkState.CLOSED
        pc.dispose()
    }

    private suspend fun sdp(op: (SdpObserver) -> Unit): SessionDescription = suspendCancellableCoroutine { k ->
        op(object : SdpObserver {
            override fun onCreateSuccess(d: SessionDescription) { k.resume(d) }
            override fun onCreateFailure(e: String?) { k.resumeWithException(IllegalStateException(e)) }
            override fun onSetSuccess() {}
            override fun onSetFailure(e: String?) {}
        })
    }

    private suspend fun unit(op: (SdpObserver) -> Unit): Unit = suspendCancellableCoroutine { k ->
        op(object : SdpObserver {
            override fun onCreateSuccess(d: SessionDescription) {}
            override fun onCreateFailure(e: String?) {}
            override fun onSetSuccess() { k.resume(Unit) }
            override fun onSetFailure(e: String?) { k.resumeWithException(IllegalStateException(e)) }
        })
    }
}
