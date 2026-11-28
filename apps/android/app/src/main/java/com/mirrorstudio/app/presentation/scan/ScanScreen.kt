package com.mirrorstudio.app.presentation.scan

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import com.mirrorstudio.app.domain.MeetingLink
import com.mirrorstudio.app.presentation.motion.Motion
import com.mirrorstudio.app.presentation.motion.rememberTick
import com.mirrorstudio.app.presentation.theme.Ms
import com.mirrorstudio.app.presentation.ui.BtnKind
import com.mirrorstudio.app.presentation.ui.Ic
import com.mirrorstudio.app.presentation.ui.MsButton
import com.mirrorstudio.app.presentation.ui.RoundButton
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.util.concurrent.Executors

/**
 * Pantallas 03 y 36: lee el QR de la reunion (o el de vincular). Al leerlo, las cuatro esquinas del visor se
 * cierran sobre el QR, aparece un visto y el telefono vibra (300 ms).
 */
@Composable
fun ScanScreen(
    onBack: () -> Unit,
    onManual: () -> Unit,
    onLink: (MeetingLink) -> Unit,
    title: String = "Escanear QR",
    hint: String = "Apunta al QR que muestra la PC anfitriona en su sala."
) {
    val context = LocalContext.current
    var granted by remember { mutableStateOf(ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) }
    var denied by remember { mutableStateOf(false) }
    val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok -> granted = ok; denied = !ok }
    LaunchedEffect(Unit) { if (!granted) ask.launch(Manifest.permission.CAMERA) }

    var found by remember { mutableStateOf<MeetingLink?>(null) }
    var wrong by remember { mutableStateOf(false) }
    val close = remember { Animatable(0f) }
    val scope = rememberCoroutineScope()
    val tick = rememberTick()

    fun onCode(raw: String) {
        if (found != null) return
        val link = MeetingLink.parse(raw)
        if (link == null) { wrong = true; return }
        found = link
        tick()
        scope.launch {
            close.animateTo(1f, tween(300, easing = Motion.Ease))
            delay(250)
            onLink(link)
        }
    }

    com.mirrorstudio.app.presentation.ui.DarkSystemBars()
    Box(Modifier.fillMaxSize().background(Color.Black)) {
        if (granted) CameraPreview(::onCode)
        Canvas(Modifier.fillMaxSize()) {
            val side = size.minDimension * 0.66f
            val inset = side * 0.18f * close.value
            val l = (size.width - side) / 2 + inset
            val t = (size.height - side) / 2 - size.height * 0.05f + inset
            val s = side - inset * 2
            val arm = s * 0.18f
            val st = Stroke(5.dp.toPx(), cap = StrokeCap.Round)
            val c = if (found != null) Color(0xFF34D399) else Color.White
            fun corner(x: Float, y: Float, dx: Float, dy: Float) {
                drawLine(c, Offset(x, y), Offset(x + arm * dx, y), st.width, StrokeCap.Round)
                drawLine(c, Offset(x, y), Offset(x, y + arm * dy), st.width, StrokeCap.Round)
            }
            corner(l, t, 1f, 1f); corner(l + s, t, -1f, 1f); corner(l, t + s, 1f, -1f); corner(l + s, t + s, -1f, -1f)
        }
        AnimatedVisibility(found != null, Modifier.align(Alignment.Center).padding(bottom = 60.dp), enter = scaleIn(tween(200)) + fadeIn()) {
            Box(Modifier.size(72.dp).background(Color(0xFF34D399), CircleShape), contentAlignment = Alignment.Center) {
                Icon(Ic.Check, null, tint = Color.White, modifier = Modifier.size(40.dp))
            }
        }
        Column(Modifier.fillMaxSize().safeDrawingPadding().padding(16.dp)) {
            Box(Modifier.fillMaxWidth()) {
                RoundButton(Ic.Close, "Cerrar", onBack, bg = Color.Black.copy(alpha = 0.4f), fg = Color.White, bordered = false)
                Text(title, style = MaterialTheme.typography.titleMedium, color = Color.White, modifier = Modifier.align(Alignment.Center))
            }
            Spacer(Modifier.weight(1f))
            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxWidth()) {
                when {
                    !granted -> Text(
                        if (denied) "Sin permiso de cámara no se puede leer el QR. Puedes darlo en Ajustes o escribir la IP y el código."
                        else "La cámara se usa solo para leer el QR de la reunión y para la cámara de documentos. Nunca graba nada.",
                        color = Color.White, textAlign = TextAlign.Center, style = MaterialTheme.typography.bodyMedium
                    )
                    wrong && found == null -> Text("Ese QR no es de una reunión de MirrorStudio.", color = Color(0xFFFCD34D), textAlign = TextAlign.Center)
                    else -> Text(hint, color = Color.White, textAlign = TextAlign.Center)
                }
                if (!granted && denied) MsButton("Permitir cámara", { ask.launch(Manifest.permission.CAMERA) }, kind = BtnKind.Accent)
                MsButton("Escribir IP y código", onManual, kind = BtnKind.Secondary, icon = Ic.Keyboard)
                Spacer(Modifier.height(8.dp))
            }
        }
    }
}

@Composable
private fun CameraPreview(onCode: (String) -> Unit) {
    val context = LocalContext.current
    val owner = LocalLifecycleOwner.current
    val executor = remember { Executors.newSingleThreadExecutor() }
    val scanner = remember { BarcodeScanning.getClient(BarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build()) }
    DisposableEffect(Unit) { onDispose { scanner.close(); executor.shutdown() } }

    AndroidView(
        factory = { ctx ->
            val view = PreviewView(ctx).apply { scaleType = PreviewView.ScaleType.FILL_CENTER }
            val future = ProcessCameraProvider.getInstance(ctx)
            future.addListener({
                val provider = future.get()
                val preview = Preview.Builder().build().also { it.surfaceProvider = view.surfaceProvider }
                val analysis = ImageAnalysis.Builder().setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST).build()
                analysis.setAnalyzer(executor) { proxy ->
                    val media = proxy.image
                    if (media == null) { proxy.close(); return@setAnalyzer }
                    scanner.process(InputImage.fromMediaImage(media, proxy.imageInfo.rotationDegrees))
                        .addOnSuccessListener { codes -> codes.firstNotNullOfOrNull { it.rawValue }?.let(onCode) }
                        .addOnCompleteListener { proxy.close() }
                }
                runCatching {
                    provider.unbindAll()
                    provider.bindToLifecycle(owner, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis)
                }
            }, ContextCompat.getMainExecutor(ctx))
            view
        },
        modifier = Modifier.fillMaxSize()
    )
}
