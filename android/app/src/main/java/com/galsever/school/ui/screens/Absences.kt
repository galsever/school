package com.galsever.school.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ExpandLess
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.DateRangePicker
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.material3.rememberDateRangePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.galsever.school.net.AbsenceDay
import com.galsever.school.net.Attendance
import com.galsever.school.net.SubjectStats
import com.galsever.school.ui.CardBox
import com.galsever.school.ui.Content
import com.galsever.school.ui.EmptyText
import com.galsever.school.ui.Files
import com.galsever.school.ui.LocalNav
import com.galsever.school.ui.LocalSnack
import com.galsever.school.ui.Pill
import com.galsever.school.ui.Routes
import com.galsever.school.ui.TopBar
import com.galsever.school.ui.act
import com.galsever.school.ui.app
import com.galsever.school.ui.dateText
import com.galsever.school.ui.rememberLoader
import com.galsever.school.ui.theme.Sc
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.Locale

@Composable
fun AbsencesScreen() {
    val nav = LocalNav.current
    val scope = rememberCoroutineScope()
    val snack = LocalSnack.current
    val days = rememberLoader("absences") { app.api.absences() }
    var tab by rememberSaveable { mutableStateOf("days") }
    var syncing by remember { mutableStateOf(false) }
    var autoSynced by rememberSaveable { mutableStateOf(false) }
    val sync = days.data?.sync

    fun pull(force: Boolean) = scope.act(snack) {
        syncing = true
        try {
            app.api.absencesSync(force)
            days.reload()
        } finally {
            syncing = false
        }
    }
    // pull WebUntis once when the stored data is older than 30 minutes
    LaunchedEffect(sync?.stale) {
        if (sync != null && sync.stale && !sync.blocked && !autoSynced) {
            autoSynced = true
            pull(false)
        }
    }

    Column(Modifier.fillMaxSize()) {
        TopBar("Absences") {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                Pill("Days", tab == "days") { tab = "days" }
                Pill("Attendance", tab == "attendance") { tab = "attendance" }
                if (sync?.configured == true) IconButton(onClick = { pull(true) }, enabled = !syncing && !sync.blocked) {
                    if (syncing) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                    else Icon(Icons.Outlined.Refresh, "Refresh from WebUntis", tint = Sc.mutedFg)
                }
            }
        }
        sync?.lastError?.takeIf { !syncing }?.let { Text(it, color = Sc.destructive, fontSize = 12.sp, modifier = Modifier.padding(horizontal = 16.dp)) }
        Content(days) { d ->
            when {
                !d.sync.configured -> Box(Modifier.fillMaxWidth().padding(40.dp), contentAlignment = Alignment.Center) {
                    Button(onClick = { nav.navigate(Routes.SETTINGS) }) { Text("Connect WebUntis") }
                }
                tab == "attendance" -> AttendanceTab()
                else -> DaysTab(d.days, syncing) { days.reload() }
            }
        }
    }
}

// ---- days: own reason per day, days into the Entschuldigung PDF ---------------------------------------------

private val STATUS = mapOf(
    "excused" to ("Excused" to Sc.green),
    "partial" to ("Partly excused" to Sc.amber),
    "open" to ("Open" to Sc.destructive),
)

@Composable
private fun DaysTab(days: List<AbsenceDay>, syncing: Boolean, reload: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val snack = LocalSnack.current
    // reasons typed here win over the loaded ones while the screen is open
    val edits = remember { mutableStateMapOf<String, String>() }
    val saved = remember { mutableStateMapOf<String, String>() }
    val timers = remember { HashMap<String, Job>() }
    var selected by rememberSaveable { mutableStateOf(setOf<String>()) }
    var exporting by remember { mutableStateOf(false) }

    fun reason(d: AbsenceDay) = edits[d.date] ?: d.reason

    if (days.isEmpty()) {
        EmptyText(if (syncing) "Loading from WebUntis" else "No absences")
        return
    }
    Column(Modifier.fillMaxSize()) {
        LazyColumn(Modifier.weight(1f), contentPadding = androidx.compose.foundation.layout.PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            items(days, key = { it.date }) { d ->
                val r = reason(d)
                val (label, color) = STATUS[d.status] ?: ("Open" to Sc.destructive)
                val isSelected = d.date in selected
                Column(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Sc.card)
                        .let { if (isSelected) it.background(Sc.primary.copy(alpha = 0.06f)) else it }
                        .padding(14.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Row(verticalAlignment = Alignment.Top) {
                        Column(Modifier.weight(1f)) {
                            Text(dayText(d.date), fontWeight = FontWeight.Medium)
                            d.exportedAt?.let { Text("In a PDF since " + dateText(it.take(10)), fontSize = 12.sp, color = Sc.mutedFg) }
                        }
                        Text(
                            label,
                            fontSize = 12.sp,
                            color = color,
                            modifier = Modifier.clip(RoundedCornerShape(50)).background(color.copy(alpha = 0.15f)).padding(horizontal = 8.dp, vertical = 2.dp),
                        )
                    }
                    d.absences.forEach { a ->
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Text(clock(a.start) + " - " + clock(a.end), fontSize = 14.sp)
                            if (a.units.isNotEmpty()) Text(unitsText(a.units), fontSize = 14.sp, color = Sc.mutedFg)
                            if (a.lateMinutes > 0) Text(
                                if (a.late) "Late · ${a.lateMinutes} min" else "incl. ${a.lateMinutes} min late",
                                fontSize = 12.sp,
                                color = Sc.amber,
                                modifier = Modifier.clip(RoundedCornerShape(6.dp)).background(Sc.amber.copy(alpha = 0.15f)).padding(horizontal = 6.dp, vertical = 1.dp),
                            )
                            if (a.untisReason.isNotBlank() && a.untisReason != "Verspätung") Text("WebUntis: ${a.untisReason}", fontSize = 12.sp, color = Sc.mutedFg)
                            if (d.status == "partial") Text(if (a.excused) "Excused" else "Open", fontSize = 12.sp, color = if (a.excused) Sc.green else Sc.destructive)
                        }
                    }
                    TextField(
                        value = r,
                        onValueChange = { v ->
                            edits[d.date] = v
                            saved[d.date] = "Saving"
                            if (v.isBlank()) selected = selected - d.date
                            timers[d.date]?.cancel()
                            timers[d.date] = scope.launch {
                                delay(600)
                                saved[d.date] = try {
                                    app.api.setReason(d.date, v)
                                    "Saved"
                                } catch (e: Exception) {
                                    "Not saved"
                                }
                            }
                        },
                        placeholder = { Text("Reason") },
                        colors = fieldColors(),
                        shape = RoundedCornerShape(10.dp),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Row(
                            Modifier.clickable(enabled = r.isNotBlank()) { selected = if (isSelected) selected - d.date else selected + d.date },
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Checkbox(
                                checked = isSelected,
                                onCheckedChange = { on -> selected = if (on) selected + d.date else selected - d.date },
                                enabled = r.isNotBlank(),
                                colors = CheckboxDefaults.colors(checkedColor = Sc.primary, checkmarkColor = Sc.onPrimary),
                            )
                            Text("PDF", fontSize = 14.sp, color = if (r.isNotBlank()) Sc.fg else Sc.mutedFg)
                        }
                        Text(saved[d.date] ?: "", fontSize = 12.sp, color = Sc.mutedFg, modifier = Modifier.weight(1f), textAlign = androidx.compose.ui.text.style.TextAlign.End)
                    }
                }
            }
        }
        if (selected.isNotEmpty()) Row(
            Modifier.fillMaxWidth().background(Sc.bar).padding(horizontal = 16.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(if (selected.size == 1) "1 day" else "${selected.size} days", modifier = Modifier.weight(1f))
            TextButton(onClick = { selected = emptySet() }) { Text("Clear") }
            Button(
                enabled = !exporting,
                onClick = {
                    exporting = true
                    scope.act(snack) {
                        try {
                            val target = Files.newFile(ctx, "Entschuldigung.pdf")
                            val name = app.api.letter(selected.sorted(), target)
                            val file = java.io.File(target.parentFile, name).also { target.renameTo(it) }
                            selected = emptySet()
                            reload()
                            Files.open(ctx, file, "application/pdf")
                        } finally {
                            exporting = false
                        }
                    }
                },
            ) { Text("Create PDF") }
        }
    }
}

private fun clock(min: Int) = String.format(Locale.US, "%02d:%02d", min / 60, min % 60)

/** ["3","4","5","7"] -> "Lesson 3-5, 7" */
private fun unitsText(units: List<String>): String {
    val nums = units.map { it.toIntOrNull() }
    if (nums.any { it == null }) return "Lesson " + units.joinToString(", ")
    val runs = mutableListOf<IntArray>()
    for (n in nums.filterNotNull()) {
        val last = runs.lastOrNull()
        if (last != null && n == last[1] + 1) last[1] = n else runs.add(intArrayOf(n, n))
    }
    return "Lesson " + runs.joinToString(", ") { if (it[0] == it[1]) "${it[0]}" else "${it[0]}-${it[1]}" }
}

/** "2026-10-06" -> "Tuesday, 06.10.2026" */
private fun dayText(iso: String): String = runCatching {
    val d = LocalDate.parse(iso)
    d.format(DateTimeFormatter.ofPattern("EEEE", Locale.ENGLISH)) + ", " + dateText(iso)
}.getOrDefault(iso)

// ---- attendance per subject ------------------------------------------------------------------------

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
private fun AttendanceTab() {
    var range by rememberSaveable { mutableStateOf<String?>(null) }
    var from by rememberSaveable { mutableStateOf<String?>(null) }
    var to by rememberSaveable { mutableStateOf<String?>(null) }
    var picking by remember { mutableStateOf(false) }
    val att = rememberLoader("attendance:$range:$from:$to") { app.api.attendance(range, from, to) }

    Content(att) { a ->
        val r = a.range
        if (r == null || a.total == null) {
            EmptyText("No data yet")
            return@Content
        }
        LazyColumn(contentPadding = androidx.compose.foundation.layout.PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            item {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf("s1" to "Semester 1", "s2" to "Semester 2", "year" to "Year").forEach { (k, label) ->
                        Pill(label, r.key == k) { range = k; from = null; to = null }
                    }
                    Pill(if (r.key == "custom") dateText(r.start) + " - " + dateText(r.end) else "Dates", r.key == "custom") { picking = true }
                }
            }
            item { SubjectCard(a.total.copy(subject = "Total", subjectLong = dateText(r.start) + " - " + dateText(r.end)), large = true) }
            if (a.subjects.isEmpty()) item { EmptyText("No lessons held yet") }
            items(a.subjects, key = { it.subject }) { SubjectCard(it) }
            item { Groups(a) { att.reload() } }
        }
        if (picking) {
            val state = rememberDateRangePickerState(
                initialSelectedStartDateMillis = LocalDate.parse(r.start).atStartOfDay().toInstant(ZoneOffset.UTC).toEpochMilli(),
                initialSelectedEndDateMillis = LocalDate.parse(r.end).atStartOfDay().toInstant(ZoneOffset.UTC).toEpochMilli(),
            )
            DatePickerDialog(
                onDismissRequest = { picking = false },
                confirmButton = {
                    TextButton(
                        enabled = state.selectedStartDateMillis != null && state.selectedEndDateMillis != null,
                        onClick = {
                            fun day(ms: Long) = Instant.ofEpochMilli(ms).atZone(ZoneOffset.UTC).toLocalDate().toString()
                            from = day(state.selectedStartDateMillis!!)
                            to = day(state.selectedEndDateMillis!!)
                            range = null
                            picking = false
                        },
                    ) { Text("Show") }
                },
                dismissButton = { TextButton(onClick = { picking = false }) { Text("Cancel") } },
            ) { DateRangePicker(state, modifier = Modifier.height(520.dp)) }
        }
    }
}

private fun tone(p: Double?): Color = when {
    p == null -> Sc.mutedFg
    p > 70 -> Sc.green
    p >= 50 -> Sc.amber
    else -> Sc.destructive
}

@Composable
private fun SubjectCard(s: SubjectStats, large: Boolean = false) {
    CardBox {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(s.subject, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(s.subjectLong, fontSize = 12.sp, color = Sc.mutedFg, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                Text(
                    s.percent?.let { "${Math.round(it)} %" } ?: "-",
                    fontSize = if (large) 34.sp else 28.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = tone(s.percent),
                )
            }
            Row(Modifier.fillMaxWidth().height(8.dp).clip(RoundedCornerShape(50)).background(Sc.muted)) {
                if (s.held > 0) {
                    if (s.present > 0) Box(Modifier.weight(s.present.toFloat()).fillMaxHeight().background(Sc.green))
                    if (s.excused > 0) Box(Modifier.weight(s.excused.toFloat()).fillMaxHeight().background(Sc.sky))
                    if (s.unexcused > 0) Box(Modifier.weight(s.unexcused.toFloat()).fillMaxHeight().background(Sc.destructive))
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                Text("Held ${s.held}", fontSize = 12.sp, color = Sc.mutedFg)
                Text("Excused ${s.excused}", fontSize = 12.sp, color = Sc.sky)
                Text("Unexcused ${s.unexcused}", fontSize = 12.sp, color = if (s.unexcused > 0) Sc.destructive else Sc.mutedFg)
            }
        }
    }
}

/** Subjects counted as one, e.g. BWM = BWM1 + BWM2. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Groups(a: Attendance, changed: () -> Unit) {
    val scope = rememberCoroutineScope()
    val snack = LocalSnack.current
    var open by rememberSaveable { mutableStateOf(false) }
    var picked by rememberSaveable { mutableStateOf(listOf<String>()) }
    var name by rememberSaveable { mutableStateOf("") }
    CardBox {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(Modifier.fillMaxWidth().clickable { open = !open }, verticalAlignment = Alignment.CenterVertically) {
                Text("Group subjects", fontWeight = FontWeight.Medium, modifier = Modifier.weight(1f))
                Icon(if (open) Icons.Outlined.ExpandLess else Icons.Outlined.ExpandMore, null, tint = Sc.mutedFg)
            }
            if (open) {
                a.groups.forEach { g ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(g.name, fontWeight = FontWeight.Medium)
                        Text("  " + g.subjects.joinToString(" + "), color = Sc.mutedFg, fontSize = 13.sp, modifier = Modifier.weight(1f))
                        TextButton(onClick = { scope.act(snack) { app.api.deleteGroup(g.name); changed() } }) { Text("Remove") }
                    }
                }
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    a.allSubjects.forEach { s -> Pill(s, s in picked) { picked = if (s in picked) picked - s else picked + s } }
                }
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    TextField(name, { name = it.take(40) }, placeholder = { Text("Name") }, singleLine = true, colors = fieldColors(), modifier = Modifier.weight(1f))
                    Button(
                        enabled = name.isNotBlank() && picked.size >= 2,
                        onClick = {
                            scope.act(snack) {
                                app.api.saveGroup(name.trim(), picked)
                                picked = emptyList()
                                name = ""
                                changed()
                            }
                        },
                    ) { Text("Group") }
                }
            }
        }
    }
}
