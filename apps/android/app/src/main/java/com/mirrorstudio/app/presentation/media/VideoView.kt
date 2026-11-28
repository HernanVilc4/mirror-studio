package com.mirrorstudio.app.presentation.media

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import org.webrtc.EglBase
import org.webrtc.RendererCommon
import org.webrtc.SurfaceViewRenderer
import org.webrtc.VideoTrack

/**
 * Pinta una pista de WebRTC. Encaja la imagen sin recortar (una diapositiva no debe perder bordes), salvo
 * con [fill] (la vista previa de la camara). [mirror] para la camara frontal.
 */
@Composable
fun VideoView(
    track: VideoTrack, egl: EglBase, modifier: Modifier = Modifier, fill: Boolean = false, mirror: Boolean = false,
    onFrameSize: ((Int, Int) -> Unit)? = null
) {
    val sizeCallback = androidx.compose.runtime.rememberUpdatedState(onFrameSize)
    val context = LocalContext.current
    val renderer = remember {
        SurfaceViewRenderer(context).apply {
            init(egl.eglBaseContext, object : RendererCommon.RendererEvents {
                override fun onFirstFrameRendered() {}
                override fun onFrameResolutionChanged(w: Int, h: Int, rotation: Int) {
                    val (fw, fh) = if (rotation % 180 == 0) w to h else h to w
                    post { sizeCallback.value?.invoke(fw, fh) }
                }
            })
            setEnableHardwareScaler(true)
        }
    }
    DisposableEffect(renderer) { onDispose { renderer.release() } }
    DisposableEffect(track, renderer) {
        runCatching { track.addSink(renderer) }
        onDispose { runCatching { track.removeSink(renderer) } }
    }
    AndroidView(
        factory = { renderer },
        update = {
            it.setScalingType(if (fill) RendererCommon.ScalingType.SCALE_ASPECT_FILL else RendererCommon.ScalingType.SCALE_ASPECT_FIT)
            it.setMirror(mirror)
        },
        modifier = modifier
    )
}
