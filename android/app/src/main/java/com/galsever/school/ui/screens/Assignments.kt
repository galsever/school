package com.galsever.school.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.outlined.AttachFile
import androidx.compose.material.icons.outlined.CameraAlt
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.OpenInNew
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.galsever.school.net.Assignment
import com.galsever.school.net.Resource
import com.galsever.school.ui.CardBox
import com.galsever.school.ui.Content
import com.galsever.school.ui.EmptyText
import com.galsever.school.ui.Files
import com.galsever.school.ui.HtmlView
import com.galsever.school.ui.Html
import com.galsever.school.ui.LocalNav
import com.galsever.school.ui.LocalSnack
import com.galsever.school.ui.Pill
import com.galsever.school.ui.Routes
import com.galsever.school.ui.SectionTitle
import com.galsever.school.ui.TopBar
import com.galsever.school.ui.act
import com.galsever.school.ui.app
import com.galsever.school.ui.dueText
import com.galsever.school.ui.longTime
import com.galsever.school.ui.parseTime
import com.galsever.school.ui.rememberFilePicker
import com.galsever.school.ui.rememberLoader
import com.galsever.school.ui.rememberScanner
import com.galsever.school.ui.theme.Sc
import java.io.File
import java.time.ZonedDateTime

private const val STALE_DAYS = 60L

/** Still worth doing: not turned in, not closed, and not abandoned long ago (the website's rule). */
fun isOpen(a: Assignment): Boolean {
    val now = ZonedDateTime.now()
    if (a.done) return false
    if (parseTime(a.closes)?.isBefore(now) == true) return false
    val due = parseTime(a.due) ?: return true
    return due.isAfter(now.minusDays(STALE_DAYS))
}

@Composable
fun AssignmentsScreen() {
    val list = rememberLoader("assignments") { app.api.assignments() }
    var all by rememberSaveable { mutableStateOf(false) }
    Column(Modifier.fillMaxSize()) {
        TopBar("Assignments") {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Pill("Open", !all) { all = false }
                Pill("All", all) { all = true }
            }
        }
        Content(list) { items ->
            val shown = if (all) items.sortedByDescending { it.due ?: "" } else items.filter(::isOpen)
            if (shown.isEmpty()) EmptyText(if (all) "No assignments" else "Nothing open")
            LazyColumn(Modifier.fillMaxSize()) { items(shown, key = { it.classId + it.id }) { AssignmentRow(it) } }
        }
    }
}

@Composable
fun AssignmentRow(a: Assignment, showClass: Boolean = true) {
    val nav = LocalNav.current
    Row(
        Modifier.fillMaxWidth().clickable { nav.navigate(Routes.assignment(a.classId, a.id)) }.padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(a.title, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (showClass) Text(a.className, fontSize = 13.sp, color = Sc.mutedFg, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        if (a.done) Icon(Icons.Filled.CheckCircle, "Done", tint = Sc.primary, modifier = Modifier.size(20.dp))
        else {
            val due = dueText(a.due)
            Text(due.text, fontSize = 12.sp, color = if (due.late) Sc.destructive else if (due.soon) Sc.amber else Sc.mutedFg)
        }
    }
}

// ---- one assignment ---------------------------------------------------------------------------

@Composable
fun AssignmentScreen(classId: String, id: String) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val snack = LocalSnack.current
    val a = rememberLoader("assignment:$classId:$id") { app.api.assignment(classId, id) }
    var busy by remember { mutableStateOf<String?>(null) }
    var confirmTurnIn by remember { mutableStateOf(false) }

    fun upload(files: List<File>) = scope.act(snack) {
        try {
            for (f in files) {
                busy = "Uploading ${f.name}"
                app.api.uploadWork(classId, id, f.name, f)
            }
        } finally {
            busy = null
            a.reload()
        }
    }
    val pick = rememberFilePicker { upload(it) }
    val scan = rememberScanner(snack) { upload(listOf(it)) }

    Column(Modifier.fillMaxSize()) {
        TopBar(a.data?.title ?: "Assignment", subtitle = a.data?.className, back = true) {
            a.data?.webUrl?.let { url -> IconButton(onClick = { Files.openUrl(ctx, url) }) { Icon(Icons.Outlined.OpenInNew, "Open in Teams") } }
        }
        Content(a) { d ->
            val sub = d.submission
            val submitted = sub?.status == "submitted" || sub?.status == "returned"
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    val due = dueText(d.due)
                    Chip(if (d.due == null) "No due date" else "Due " + longTime(d.due), if (due.late && !d.done) Sc.destructive else Sc.mutedFg)
                    d.points?.let { Chip("${fmt(it)} points", Sc.mutedFg) }
                    if (submitted) Chip(if (sub?.status == "returned") "Returned" else "Turned in", Sc.primary)
                }
                if (d.instructions.isNotBlank()) CardBox { HtmlView(Html.rich(d.instructions).main) }
                if (d.resources.isNotEmpty()) {
                    SectionTitle("Material", Modifier.padding(0.dp))
                    d.resources.forEach { r -> ResourceRow(r) { openResource(ctx, scope, snack, it, r.name) } }
                }
                if (sub != null) {
                    SectionTitle("My work", Modifier.padding(0.dp))
                    if (sub.resources.isEmpty()) Text("Nothing added", color = Sc.mutedFg, fontSize = 14.sp)
                    sub.resources.forEach { r ->
                        ResourceRow(r, onRemove = if (!submitted && d.canEdit) ({
                            scope.act(snack) { app.api.removeWork(classId, id, r.id); a.reload() }
                        }) else null) { openResource(ctx, scope, snack, it, r.name) }
                    }
                    busy?.let {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                            Text(it, fontSize = 13.sp, color = Sc.mutedFg)
                        }
                    }
                    if (!submitted && d.canEdit) Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(onClick = pick, enabled = busy == null) {
                            Icon(Icons.Outlined.AttachFile, null, Modifier.size(18.dp)); Text(" File")
                        }
                        OutlinedButton(onClick = scan, enabled = busy == null) {
                            Icon(Icons.Outlined.CameraAlt, null, Modifier.size(18.dp)); Text(" Scan")
                        }
                    }
                    when {
                        !submitted && d.canEdit -> Button(onClick = { confirmTurnIn = true }, enabled = busy == null, modifier = Modifier.fillMaxWidth()) {
                            Text("Turn in")
                        }
                        sub.status == "submitted" && d.canUndo -> OutlinedButton(
                            onClick = { scope.act(snack) { app.api.undoTurnIn(classId, id); a.reload() } },
                            modifier = Modifier.fillMaxWidth(),
                        ) { Text("Undo turn in") }
                    }
                    if (sub.feedback.isNotEmpty() || sub.points != null) {
                        SectionTitle("Feedback", Modifier.padding(0.dp))
                        CardBox {
                            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                sub.points?.let { p -> Text("${fmt(p)}" + (d.points?.let { " / ${fmt(it)}" } ?: "") + " points", fontWeight = FontWeight.SemiBold) }
                                sub.feedback.forEach { Text(Html.text(it)) }
                            }
                        }
                    }
                }
            }
        }
    }

    if (confirmTurnIn) AlertDialog(
        onDismissRequest = { confirmTurnIn = false },
        title = { Text("Turn in?") },
        text = { Text(a.data?.title ?: "") },
        confirmButton = {
            TextButton(onClick = {
                confirmTurnIn = false
                scope.act(snack) { app.api.turnIn(classId, id); a.reload() }
            }) { Text("Turn in") }
        },
        dismissButton = { TextButton(onClick = { confirmTurnIn = false }) { Text("Cancel") } },
    )
}

private fun fmt(d: Double) = if (d == Math.floor(d)) d.toLong().toString() else d.toString()

/** Small rounded label (due date, points, status). */
@Composable
fun Chip(text: String, color: androidx.compose.ui.graphics.Color) {
    Text(
        text,
        fontSize = 12.sp,
        color = color,
        modifier = Modifier
            .clip(androidx.compose.foundation.shape.RoundedCornerShape(50))
            .background(Sc.muted)
            .padding(horizontal = 10.dp, vertical = 4.dp),
    )
}

@Composable
private fun ResourceRow(r: Resource, onRemove: (() -> Unit)? = null, open: (String) -> Unit) {
    CardBox(onClick = r.url?.let { u -> { open(u) } }) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Outlined.Description, null, tint = Sc.mutedFg, modifier = Modifier.size(20.dp))
            Text(r.name, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f).padding(start = 10.dp))
            if (onRemove != null) IconButton(onClick = onRemove, modifier = Modifier.size(28.dp)) {
                Icon(Icons.Outlined.Close, "Remove", tint = Sc.mutedFg, modifier = Modifier.size(18.dp))
            }
        }
    }
}
