package com.mirrorstudio.app.presentation.room

import android.os.Build
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.mirrorstudio.app.domain.MeetingSnapshot
import com.mirrorstudio.app.domain.Member
import com.mirrorstudio.app.domain.MemberRole
import com.mirrorstudio.app.presentation.theme.Ms
import com.mirrorstudio.app.presentation.ui.Avatar
import com.mirrorstudio.app.presentation.ui.BtnKind
import com.mirrorstudio.app.presentation.ui.Card
import com.mirrorstudio.app.presentation.ui.Chip
import com.mirrorstudio.app.presentation.ui.Ic
import com.mirrorstudio.app.presentation.ui.MsButton
import com.mirrorstudio.app.presentation.ui.RoundButton

/** Pantalla 07: personas en la reunion. Los docentes piden control, cambian el rol o expulsan. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PeopleSheet(
    m: MeetingSnapshot,
    onDismiss: () -> Unit,
    onControl: (String) -> Unit,
    onRole: (String, Boolean) -> Unit,
    onKick: (String) -> Unit,
    extra: @Composable (Member) -> Unit = {},
    order: (List<Member>) -> List<Member> = { it }
) {
    val staff = m.myself?.role?.isStaff == true
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = Ms.Bg) {
        Row(Modifier.padding(horizontal = 20.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("Personas en la reunión", style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
            Chip("${m.members.size}")
        }
        LazyColumn(Modifier.navigationBarsPadding().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            itemsIndexed(order(m.members), key = { _, p -> p.id }) { _, p ->
                Card(Modifier.fillMaxWidth().animateItem(), padding = androidx.compose.foundation.layout.PaddingValues(12.dp)) {
                    Column {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Avatar(p.name, highlight = p.isMe)
                            Spacer(Modifier.width(12.dp))
                            Column(Modifier.weight(1f)) {
                                Text(if (p.isMe) "${p.name} (tú)" else p.name, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Text(
                                    listOfNotNull(
                                        roleLabel(p.role), "Anfitrión".takeIf { p.isHost },
                                        if (p.device == com.mirrorstudio.app.domain.Device.PHONE) "Teléfono" else "PC",
                                        p.hand?.let { "mano levantada ($it.º)" }
                                    ).joinToString(" · "),
                                    style = MaterialTheme.typography.bodySmall, color = Ms.Muted
                                )
                            }
                            extra(p)
                            if (p.isPresenting) Chip("Presenta")
                            if (staff && !p.isMe) MemberMenu(p, m.myself?.role, onRole, onKick)
                        }
                        if (staff && !p.isMe && p.device == com.mirrorstudio.app.domain.Device.PC) {
                            Spacer(Modifier.size(8.dp))
                            MsButton("Pedir control de su PC", { onControl(p.id) }, Modifier.fillMaxWidth(), kind = BtnKind.Secondary, icon = Ic.Pointer, small = true)
                        }
                    }
                }
            }
        }
    }
}

private fun roleLabel(r: MemberRole) = if (r == MemberRole.CREATOR) "Creador" else r.label

@Composable
private fun MemberMenu(p: Member, myRole: MemberRole?, onRole: (String, Boolean) -> Unit, onKick: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        RoundButton(Ic.More, "Más opciones de ${p.name}", { open = true }, size = 36.dp, bordered = false)
        DropdownMenu(open, { open = false }, containerColor = Ms.Surface) {
            // Como en el escritorio: solo el creador o un admin cambian roles; nadie toca al creador.
            if (p.role != MemberRole.CREATOR && (myRole == MemberRole.CREATOR || myRole == MemberRole.ADMIN)) {
                if (p.role == MemberRole.PARTICIPANT) DropdownMenuItem({ Text("Hacer docente") }, { open = false; onRole(p.id, true) })
                else DropdownMenuItem({ Text("Quitar rol de docente") }, { open = false; onRole(p.id, false) })
            }
            if (p.role != MemberRole.CREATOR) DropdownMenuItem({ Text("Expulsar", color = Ms.Danger) }, { open = false; onKick(p.id) })
        }
    }
}

/** Pantalla 10: que presentar desde el telefono. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PresentSheet(someoneElse: Boolean, onDismiss: () -> Unit, onScreen: () -> Unit, onCamera: () -> Unit) {
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = Ms.Bg) {
        Column(Modifier.navigationBarsPadding().padding(horizontal = 20.dp).padding(bottom = 20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Presentar desde el teléfono", style = MaterialTheme.typography.titleLarge)
            Text(
                if (someoneElse) "Ahora presenta otra persona. Si empiezas, la sala verá lo tuyo en su lugar cuando termine."
                else "Todos en la sala verán lo que compartas.",
                style = MaterialTheme.typography.bodyMedium, color = Ms.Muted
            )
            Option(Ic.Phone, "Toda la pantalla", "O una sola app: lo eliges en el permiso de Android.", onScreen)
            Option(Ic.Camera, "Cámara de documentos", "Muestra una hoja, un cuaderno o una maqueta con la cámara trasera.", onCamera)
            if (Build.VERSION.SDK_INT < 29) Text("El sonido del teléfono no se comparte en esta versión de Android.", style = MaterialTheme.typography.bodySmall, color = Ms.Muted)
            MsButton("Cancelar", onDismiss, Modifier.fillMaxWidth(), kind = BtnKind.Ghost)
        }
    }
}

@Composable
private fun Option(icon: ImageVector, title: String, body: String, onClick: () -> Unit) {
    Card(Modifier.fillMaxWidth(), onClick = onClick) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(44.dp).background(Ms.AccentSoft, RoundedCornerShape(12.dp)), contentAlignment = Alignment.Center) {
                Icon(icon, null, tint = Ms.Accent, modifier = Modifier.size(22.dp))
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(title, style = MaterialTheme.typography.titleSmall)
                Text(body, style = MaterialTheme.typography.bodySmall, color = Ms.Muted)
            }
            Icon(Ic.Next, null, tint = Ms.Muted, modifier = Modifier.size(20.dp))
        }
    }
}
