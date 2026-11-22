package com.mirrorstudio

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay

private val Bg = Color(0xFF111317)
private val Card = Color(0xFF1A1D23)
private val Accent = Color(0xFF3B82F6)
private val Ok = Color(0xFF34D399)
private val Muted = Color(0xFF8B93A1)

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme(colorScheme = darkColorScheme(primary = Accent, background = Bg, surface = Bg)) {
                Surface(Modifier.fillMaxSize(), color = Bg) { Screen() }
            }
        }
    }

    @Composable
    fun Screen() {
        var host by remember { mutableStateOf("") }
        var port by remember { mutableStateOf(Discovery.PORT.toString()) }
        var token by remember { mutableStateOf("") }
        var found by remember { mutableStateOf<List<String>>(emptyList()) }
        var scanning by remember { mutableStateOf(true) }
        var scanNonce by remember { mutableIntStateOf(0) }
        var manual by remember { mutableStateOf(false) }
        var ctlOn by remember { mutableStateOf(ControlService.enabled) }
        val status by CaptureService.status.collectAsState()
        val events by CaptureService.controlEvents.collectAsState()
        val lastGesture by ControlService.last.collectAsState()

        val projection = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
            if (r.resultCode == Activity.RESULT_OK && r.data != null) {
                startForegroundService(Intent(this, CaptureService::class.java)
                    .putExtra("host", host).putExtra("port", port.toIntOrNull() ?: Discovery.PORT).putExtra("token", token)
                    .putExtra("resultCode", r.resultCode).putExtra("data", r.data))
            } else CaptureService.status.value = "Autoriza compartir pantalla en tu teléfono para comenzar."
        }
        fun connect(h: String, p: String = Discovery.PORT.toString(), t: String = "") {
            host = h; port = p; token = t
            CaptureService.status.value = "Pidiendo permiso para compartir pantalla…"
            projection.launch((getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager).createScreenCaptureIntent())
        }

        // First launch: ask for notification permission up front (needed to show the "sharing" notice on Android 13+).
        val notif = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {}
        LaunchedEffect(Unit) {
            if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
                notif.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
        LaunchedEffect(scanNonce) {
            scanning = true
            found = runCatching { Discovery.scan() }.getOrDefault(emptyList())
            scanning = false
        }
        LaunchedEffect(Unit) { while (true) { ctlOn = ControlService.enabled; delay(1000) } }

        val scanner = rememberLauncherForActivityResult(com.journeyapps.barcodescanner.ScanContract()) { res ->
            val text = res.contents ?: return@rememberLauncherForActivityResult
            runCatching {
                val j = org.json.JSONObject(text)
                connect(j.getString("host"), j.getInt("port").toString(), j.getString("token"))
            }.onFailure { CaptureService.status.value = "Ese QR no es de Mirror Studio." }
        }

        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Header(scanning)

            Card2 {
                Text("Equipos encontrados", fontSize = 16.sp)
                Spacer(Modifier.height(8.dp))
                AnimatedContent(scanning to found, label = "found") { (sc, list) ->
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (list.isEmpty()) Text(if (sc) "Buscando en tu red…" else "No encontramos equipos. Comprueba que ambos estén en la misma red (Wi-Fi o hotspot), o escanea el QR.", color = Muted, fontSize = 13.sp)
                        list.forEach { ip -> PcRow(ip) { connect(ip) } }
                    }
                }
                TextButton(onClick = { scanNonce++ }, enabled = !scanning) { Text("Buscar de nuevo") }
            }

            Button(onClick = {
                scanner.launch(com.journeyapps.barcodescanner.ScanOptions().setPrompt("Escanea el QR de Mirror Studio en tu PC")
                    .setBeepEnabled(false).setOrientationLocked(false))
            }, modifier = Modifier.fillMaxWidth().height(52.dp), shape = RoundedCornerShape(14.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Accent, contentColor = Color.White)) { Text("Escanear QR") }

            Card2 {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Box(Modifier.size(10.dp).clip(CircleShape).background(if (ctlOn) Ok else Muted))
                    Text(if (ctlOn) "Control remoto activo" else "Control remoto desactivado", fontSize = 15.sp)
                }
                Text("Permite que tu PC toque y deslice en este teléfono. Es opcional y se revoca desactivándolo en Ajustes. No lee tu pantalla.", color = Muted, fontSize = 12.sp)
                if (!ctlOn) OutlinedButton(onClick = { startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) }) { Text("Abrir Accesibilidad") }
                if (ctlOn && events > 0) Text("Órdenes recibidas de la PC: $events · $lastGesture", color = Ok, fontSize = 12.sp)
            }

            AnimatedContent(status, label = "status") { s -> Text(s, color = if (s.startsWith("Transmit")) Ok else Muted, fontSize = 14.sp) }
            OutlinedButton(onClick = { stopService(Intent(this@MainActivity, CaptureService::class.java)) }, modifier = Modifier.fillMaxWidth()) { Text("Finalizar sesión") }

            TextButton(onClick = { manual = !manual }) { Text(if (manual) "Ocultar conexión manual" else "Conexión manual") }
            AnimatedVisibility(manual, enter = expandVertically() + fadeIn(), exit = shrinkVertically() + fadeOut()) {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(host, { host = it }, label = { Text("IP del equipo") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    OutlinedTextField(port, { port = it }, label = { Text("Puerto") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    OutlinedTextField(token, { token = it }, label = { Text("Código (opcional)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    Button(onClick = { connect(host, port, token) }, enabled = host.isNotBlank()) { Text("Conectar") }
                }
            }
        }
    }

    @Composable
    private fun Header(scanning: Boolean) {
        val t = rememberInfiniteTransition(label = "pulse")
        val s by t.animateFloat(0.7f, 1.6f, infiniteRepeatable(tween(1800, easing = LinearEasing)), label = "s")
        val a by t.animateFloat(0.6f, 0f, infiniteRepeatable(tween(1800, easing = LinearEasing)), label = "a")
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            Box(Modifier.size(56.dp), contentAlignment = Alignment.Center) {
                if (scanning) Box(Modifier.size(40.dp).scale(s).alpha(a).background(Accent, CircleShape))
                Box(Modifier.size(40.dp).background(Accent, CircleShape), contentAlignment = Alignment.Center) { Text("M", fontSize = 20.sp, color = Color.White) }
            }
            Column {
                Text("Mirror Studio", fontSize = 24.sp)
                Text("Proyecta tu pantalla en tu PC", color = Muted, fontSize = 13.sp)
            }
        }
    }

    @Composable
    private fun PcRow(ip: String, onClick: () -> Unit) {
        Row(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Color(0xFF232830)).clickable(onClick = onClick).padding(14.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Column { Text("Mirror Studio (PC)", fontSize = 15.sp); Text(ip, color = Muted, fontSize = 12.sp) }
            Text("Conectar", color = Accent, fontSize = 14.sp)
        }
    }

    @Composable
    private fun Card2(content: @Composable ColumnScope.() -> Unit) {
        Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Card).padding(16.dp).animateContentSize(),
            verticalArrangement = Arrangement.spacedBy(6.dp), content = content)
    }
}
