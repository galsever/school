package com.galsever.school.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.outlined.Assignment
import androidx.compose.material.icons.outlined.AttachFile
import androidx.compose.material.icons.outlined.CameraAlt
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.ExpandLess
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.Link
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.OpenInNew
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Article
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.galsever.school.net.MoodleCourseContent
import com.galsever.school.net.MoodleFile
import com.galsever.school.net.MoodleModule
import com.galsever.school.ui.Cache
import com.galsever.school.ui.CardBox
import com.galsever.school.ui.Content
import com.galsever.school.ui.EmptyText
import com.galsever.school.ui.Files
import com.galsever.school.ui.Html
import com.galsever.school.ui.HtmlView
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
import com.galsever.school.ui.openRemote
import com.galsever.school.ui.rememberFilePicker
import com.galsever.school.ui.rememberLoader
import com.galsever.school.ui.rememberScanner
import com.galsever.school.ui.sizeText
import com.galsever.school.ui.theme.Sc
import java.io.File

// ---- start: due, courses, search over all courses ------------------------------------------------------------

@Composable
fun MoodleScreen() {
    val nav = LocalNav.current
    val scope = rememberCoroutineScope()
    val snack = LocalSnack.current
    val home = rememberLoader("moodle") { app.api.moodle() }
    var query by rememberSaveable { mutableStateOf("") }
    val q = query.trim()
    // the search reads every course's contents once (the hub caches them for a minute)
    val contents = remember { mutableStateMapOf<Long, MoodleCourseContent>() }
    LaunchedEffect(q.length >= 2, home.data) {
        if (q.length >= 2) home.data?.courses?.forEach { c ->
            if (c.id !in contents) runCatching { app.api.moodleCourse(c.id) }.getOrNull()?.let { contents[c.id] = it }
        }
    }

    Column(Modifier.fillMaxSize()) {
        TopBar("Moodle") {
            IconButton(onClick = { scope.act(snack) { app.api.moodleRefresh(); Cache.drop("moodle"); contents.clear(); home.reload() } }) {
                if (home.loading) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                else Icon(Icons.Outlined.Refresh, "Reload", tint = Sc.mutedFg)
            }
        }
        SearchField(query, { query = it })
        Content(home) { h ->
            LazyColumn(Modifier.fillMaxSize()) {
                if (q.length >= 2) {
                    val courses = h.courses.filter { it.name.contains(q, true) || it.short.contains(q, true) }
                    if (courses.isNotEmpty()) item { SectionTitle("Courses") }
                    items(courses, key = { "c" + it.id }) { c -> CourseRow(c.name, c.short, c.progress) { nav.navigate(Routes.course(c.id)) } }
                    val hits = contents.values.flatMap { course ->
                        course.sections.flatMap { s -> s.modules }.flatMap { m ->
                            val own = if (m.name.contains(q, true) && m.type != "label") listOf(Triple(course, m, null as MoodleFile?)) else emptyList()
                            own + m.files.filter { it.name.contains(q, true) }.map { Triple(course, m, it) }
                        }
                    }
                    if (hits.isNotEmpty()) item { SectionTitle("Files and activities") }
                    items(hits.take(80), key = { (c, m, f) -> "h${c.id}:${m.cmid}:${f?.name}" }) { (c, m, f) ->
                        HitRow(c, m, f)
                    }
                    if (courses.isEmpty() && hits.isEmpty()) item { EmptyText(if (contents.size < h.courses.size) "Searching" else "Nothing found") }
                } else {
                    if (h.due.isNotEmpty()) item { SectionTitle("Due") }
                    items(h.due, key = { "d" + it.cmid + it.name }) { d ->
                        val due = dueText(d.due)
                        Row(
                            Modifier.fillMaxWidth().clickable {
                                if (d.type == "assign" && d.cmid != null && d.courseId != null) nav.navigate(Routes.moodleAssignment(d.cmid, d.courseId))
                                else if (d.courseId != null) nav.navigate(Routes.course(d.courseId))
                            }.padding(horizontal = 16.dp, vertical = 10.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Column(Modifier.weight(1f)) {
                                Text(d.name, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Text(d.course, fontSize = 13.sp, color = Sc.mutedFg, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            }
                            Text(due.text, fontSize = 12.sp, color = if (d.overdue || due.late) Sc.destructive else if (due.soon) Sc.amber else Sc.mutedFg)
                        }
                    }
                    item { SectionTitle("Courses") }
                    items(h.courses, key = { "c" + it.id }) { c -> CourseRow(c.name, c.grade ?: c.short, c.progress) { nav.navigate(Routes.course(c.id)) } }
                }
            }
        }
    }
}

@Composable
private fun CourseRow(name: String, sub: String, progress: Double?, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(name, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (sub.isNotBlank()) Text(sub, fontSize = 13.sp, color = Sc.mutedFg, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        progress?.let { Text("${Math.round(it)} %", fontSize = 12.sp, color = Sc.mutedFg) }
    }
}

@Composable
private fun HitRow(c: MoodleCourseContent, m: MoodleModule, f: MoodleFile?) {
    val open = rememberModuleOpener(c.id)
    Row(
        Modifier.fillMaxWidth().clickable { open(m, f) }.padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(if (f != null) Icons.Outlined.Description else iconOf(m), null, tint = Sc.mutedFg, modifier = Modifier.size(20.dp))
        Column(Modifier.weight(1f).padding(start = 12.dp)) {
            Text(f?.name ?: m.name, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(c.name + if (f != null) "  ·  " + m.name else "", fontSize = 12.sp, color = Sc.mutedFg, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

private fun iconOf(m: MoodleModule): ImageVector = when {
    m.type == "assign" -> Icons.Outlined.Assignment
    m.type == "folder" -> Icons.Outlined.Folder
    m.type == "url" -> Icons.Outlined.Link
    m.type == "page" -> Icons.Outlined.Article
    else -> Icons.Outlined.Description
}

/** What a tap on a module (or one of its files) does: assignment page, file, page text, or the link in the browser. */
@Composable
private fun rememberModuleOpener(courseId: Long): (MoodleModule, MoodleFile?) -> Unit {
    val nav = LocalNav.current
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val snack = LocalSnack.current
    return { m, f ->
        when {
            f != null -> scope.openRemote(ctx, snack, f.view, f.name)
            m.type == "assign" -> nav.navigate(Routes.moodleAssignment(m.cmid, courseId))
            m.type == "resource" && m.files.size == 1 -> scope.openRemote(ctx, snack, m.files[0].view, m.files[0].name)
            m.type == "page" -> nav.navigate(Routes.moodlePage(m.url, m.name))
            m.link != null -> Files.openUrl(ctx, m.link)
            else -> Files.openUrl(ctx, m.url)
        }
    }
}

// ---- a course: sections and grades -------------------------------------------------------------------

@Composable
fun CourseScreen(id: Long) {
    val ctx = LocalContext.current
    val course = rememberLoader("moodle-course:$id") { app.api.moodleCourse(id) }
    var tab by rememberSaveable { mutableStateOf("content") }
    Column(Modifier.fillMaxSize()) {
        TopBar(course.data?.name ?: "Course", back = true) {
            IconButton(onClick = { Files.openUrl(ctx, "https://moodle.spengergasse.at/course/view.php?id=$id") }) {
                Icon(Icons.Outlined.OpenInNew, "Open in Moodle", tint = Sc.mutedFg)
            }
        }
        Row(Modifier.padding(horizontal = 12.dp, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Pill("Content", tab == "content") { tab = "content" }
            Pill("Grades", tab == "grades") { tab = "grades" }
        }
        if (tab == "grades") Grades(id) else Content(course) { c -> Sections(c) }
    }
}

@Composable
private fun Sections(c: MoodleCourseContent) {
    val open = rememberModuleOpener(c.id)
    var closed by rememberSaveable { mutableStateOf(setOf<Long>()) }
    val sections = c.sections.filter { s -> s.modules.isNotEmpty() || Html.text(s.summary).isNotBlank() }
    if (sections.isEmpty()) {
        EmptyText("Empty")
        return
    }
    LazyColumn(Modifier.fillMaxSize()) {
        sections.forEach { s ->
            val isOpen = s.id !in closed
            item(key = "s" + s.id) {
                Row(
                    Modifier.fillMaxWidth().clickable { closed = if (isOpen) closed + s.id else closed - s.id }.padding(start = 16.dp, end = 12.dp, top = 14.dp, bottom = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(s.name.ifBlank { "Section ${s.number}" }, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                    Icon(if (isOpen) Icons.Outlined.ExpandLess else Icons.Outlined.ExpandMore, null, tint = Sc.mutedFg)
                }
            }
            if (isOpen) moduleItems(s.modules, open)
        }
    }
}

private fun LazyListScope.moduleItems(modules: List<MoodleModule>, open: (MoodleModule, MoodleFile?) -> Unit) {
    items(modules, key = { "m" + it.cmid }) { m ->
        if (m.type == "label") {
            Box(Modifier.padding(horizontal = 16.dp, vertical = 4.dp)) { HtmlView(Html.rich(m.description).main) }
            return@items
        }
        var expanded by rememberSaveable { mutableStateOf(m.type == "folder" && m.files.size <= 6) }
        val many = m.type == "folder" || (m.type == "resource" && m.files.size > 1)
        Column {
            Row(
                Modifier.fillMaxWidth().clickable(enabled = m.restricted == null) { if (many) expanded = !expanded else open(m, null) }
                    .padding(horizontal = 16.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(iconOf(m), null, tint = if (m.type == "assign" || m.type == "folder") Sc.primary else Sc.mutedFg, modifier = Modifier.size(20.dp))
                Column(Modifier.weight(1f).padding(start = 12.dp)) {
                    Text(m.name, maxLines = 2, overflow = TextOverflow.Ellipsis, color = if (m.restricted != null) Sc.mutedFg else Sc.fg)
                    m.dates.filter { it.time != null }.forEach { Text(it.label + " " + longTime(it.time), fontSize = 12.sp, color = Sc.mutedFg) }
                    m.restricted?.let { Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Outlined.Lock, null, Modifier.size(12.dp), tint = Sc.mutedFg)
                        Text(" " + Html.text(it), fontSize = 12.sp, color = Sc.mutedFg, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    } }
                }
                if (m.done) Icon(Icons.Filled.CheckCircle, "Done", tint = Sc.primary, modifier = Modifier.size(18.dp))
                if (many) Icon(if (expanded) Icons.Outlined.ExpandLess else Icons.Outlined.ExpandMore, null, tint = Sc.mutedFg)
            }
            if (many && expanded) m.files.forEach { f -> FileRow(f, start = 48) { open(m, f) } }
        }
    }
}

@Composable
private fun FileRow(f: MoodleFile, start: Int = 16, onRemove: (() -> Unit)? = null, open: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(onClick = open).padding(start = start.dp, end = 8.dp, top = 8.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(Icons.Outlined.Description, null, tint = Sc.mutedFg, modifier = Modifier.size(18.dp))
        Text(f.name, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f).padding(start = 10.dp))
        Text(sizeText(f.size), fontSize = 12.sp, color = Sc.mutedFg)
        if (onRemove != null) IconButton(onClick = onRemove, modifier = Modifier.size(32.dp)) { Icon(Icons.Outlined.Close, "Remove", Modifier.size(16.dp), tint = Sc.mutedFg) }
    }
}

@Composable
private fun Grades(courseId: Long) {
    val nav = LocalNav.current
    val grades = rememberLoader("moodle-grades:$courseId") { app.api.moodleGrades(courseId) }
    Content(grades) { list ->
        if (list.isEmpty()) {
            EmptyText("No grades")
            return@Content
        }
        LazyColumn(Modifier.fillMaxSize()) {
            items(list) { g ->
                Row(
                    Modifier.fillMaxWidth()
                        .clickable(enabled = g.type == "assign" && g.cmid != null) { nav.navigate(Routes.moodleAssignment(g.cmid!!, courseId)) }
                        .padding(horizontal = 16.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(g.name.ifBlank { "Total" }, fontWeight = if (g.total) FontWeight.SemiBold else FontWeight.Normal, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        val sub = listOf(g.range, g.weight.takeIf { it.isNotBlank() }?.let { "Weight $it" }).filter { !it.isNullOrBlank() }.joinToString("  ·  ")
                        if (sub.isNotBlank()) Text(sub, fontSize = 12.sp, color = Sc.mutedFg)
                        if (g.feedback.isNotBlank()) Text(Html.text(g.feedback), fontSize = 13.sp, color = Sc.mutedFg, maxLines = 3, overflow = TextOverflow.Ellipsis)
                    }
                    Column(horizontalAlignment = Alignment.End) {
                        Text(g.grade.ifBlank { "-" }, fontWeight = FontWeight.SemiBold)
                        if (g.percentage.isNotBlank()) Text(g.percentage, fontSize = 12.sp, color = Sc.mutedFg)
                    }
                }
            }
        }
    }
}

// ---- a page activity ---------------------------------------------------------------------------------

@Composable
fun MoodlePageScreen(url: String, name: String) {
    val page = rememberLoader("moodle-page:$url") { app.api.moodlePage(url) }
    Column(Modifier.fillMaxSize()) {
        TopBar(name.ifBlank { "Page" }, back = true)
        Content(page) { p -> Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp)) { HtmlView(Html.rich(p.html).main) } }
    }
}

// ---- an assignment ------------------------------------------------------------------------------------

@Composable
fun MoodleAssignmentScreen(cmid: Long, course: Long) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val snack = LocalSnack.current
    val a = rememberLoader("moodle-assign:$cmid") { app.api.moodleAssignment(cmid, course) }
    var busy by remember { mutableStateOf<String?>(null) }
    var text by rememberSaveable { mutableStateOf<String?>(null) }
    var confirmSubmit by remember { mutableStateOf(false) }

    fun upload(files: List<File>) = scope.act(snack) {
        try {
            val ids = files.map { f ->
                busy = "Uploading ${f.name}"
                app.api.moodleUpload(f.name, f).id
            }
            busy = "Saving"
            a.set(app.api.moodleChange(cmid, course, add = ids))
        } finally {
            busy = null
        }
    }
    val pick = rememberFilePicker { upload(it) }
    val scan = rememberScanner(snack) { upload(listOf(it)) }

    Column(Modifier.fillMaxSize()) {
        TopBar(a.data?.name ?: "Assignment", subtitle = a.data?.course, back = true) {
            a.data?.url?.takeIf { it.isNotBlank() }?.let { url -> IconButton(onClick = { Files.openUrl(ctx, url) }) { Icon(Icons.Outlined.OpenInNew, "Open in Moodle") } }
        }
        Content(a) { d ->
            val sub = d.submission
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    val due = dueText(d.due)
                    Chip(if (d.due == null) "No due date" else "Due " + longTime(d.due), if (due.late) Sc.destructive else Sc.mutedFg)
                    sub?.let { Chip(statusText(it.status), if (it.status == "submitted") Sc.primary else Sc.mutedFg) }
                }
                if (Html.text(d.description).isNotBlank()) CardBox { HtmlView(Html.rich(d.description).main) }
                d.attachments.forEach { f -> FileRow(f, start = 4) { scope.openRemote(ctx, snack, f.view, f.name) } }

                if (!d.files && !d.onlineText) Text("Nothing to hand in here", color = Sc.mutedFg)
                else if (sub != null) {
                    SectionTitle("My work", Modifier.padding(0.dp))
                    if (d.files) {
                        if (sub.files.isEmpty()) Text("No files", color = Sc.mutedFg, fontSize = 14.sp)
                        sub.files.forEach { f ->
                            FileRow(f, start = 4, onRemove = if (sub.canEdit && busy == null) ({
                                scope.act(snack) { a.set(app.api.moodleChange(cmid, course, remove = listOf(f.name))) }
                            }) else null) { scope.openRemote(ctx, snack, f.view, f.name) }
                        }
                        if (sub.canEdit) Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            OutlinedButton(onClick = pick, enabled = busy == null) { Icon(Icons.Outlined.AttachFile, null, Modifier.size(18.dp)); Text(" File") }
                            OutlinedButton(onClick = scan, enabled = busy == null) { Icon(Icons.Outlined.CameraAlt, null, Modifier.size(18.dp)); Text(" Scan") }
                        }
                    }
                    if (d.onlineText) {
                        val value = text ?: Html.text(sub.text)
                        TextField(
                            value = value,
                            onValueChange = { text = it },
                            enabled = sub.canEdit,
                            placeholder = { Text("Text") },
                            colors = fieldColors(),
                            shape = RoundedCornerShape(12.dp),
                            modifier = Modifier.fillMaxWidth().heightIn(min = 140.dp),
                        )
                        if (text != null && sub.canEdit) Button(enabled = busy == null, onClick = {
                            scope.act(snack) {
                                busy = "Saving"
                                try {
                                    a.set(app.api.moodleChange(cmid, course, text = text))
                                    text = null
                                } finally {
                                    busy = null
                                }
                            }
                        }) { Text("Save text") }
                    }
                    busy?.let {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                            Text(it, fontSize = 13.sp, color = Sc.mutedFg)
                        }
                    }
                    if (d.submitButton && sub.needsSubmit && sub.status != "submitted") Button(
                        onClick = { confirmSubmit = true },
                        enabled = busy == null,
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text("Submit for grading") }
                }
                d.feedback?.let { fb ->
                    SectionTitle("Feedback", Modifier.padding(0.dp))
                    CardBox {
                        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            if (fb.grade.isNotBlank()) Text(fb.grade, fontWeight = FontWeight.SemiBold)
                            if (fb.comments.isNotBlank()) Text(Html.text(fb.comments))
                            fb.files.forEach { f -> FileRow(f, start = 0) { scope.openRemote(ctx, snack, f.view, f.name) } }
                        }
                    }
                }
            }
        }
    }

    if (confirmSubmit) AlertDialog(
        onDismissRequest = { confirmSubmit = false },
        title = { Text("Submit for grading?") },
        text = { Text("After that you can no longer change it.") },
        confirmButton = {
            TextButton(onClick = {
                confirmSubmit = false
                scope.act(snack) { a.set(app.api.moodleSubmit(cmid, course)) }
            }) { Text("Submit") }
        },
        dismissButton = { TextButton(onClick = { confirmSubmit = false }) { Text("Cancel") } },
    )
}

private fun statusText(s: String) = when (s) {
    "submitted" -> "Submitted"
    "draft" -> "Draft"
    "reopened" -> "Reopened"
    "none", "new", "" -> "Not submitted"
    else -> s.replaceFirstChar { it.uppercase() }
}
