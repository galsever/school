@file:OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)

package com.galsever.school.ui.screens

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Tag
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.ExpandLess
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.OpenInNew
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.galsever.school.net.Assignment
import com.galsever.school.net.Chat
import com.galsever.school.net.DriveItem
import com.galsever.school.net.Folder
import com.galsever.school.net.Team
import com.galsever.school.ui.Avatar
import com.galsever.school.ui.Cache
import com.galsever.school.ui.Content
import com.galsever.school.ui.Dot
import com.galsever.school.ui.EmptyText
import com.galsever.school.ui.Files
import com.galsever.school.ui.LocalNav
import com.galsever.school.ui.LocalSnack
import com.galsever.school.ui.Pill
import com.galsever.school.ui.Routes
import com.galsever.school.ui.SectionTitle
import com.galsever.school.ui.TopBar
import com.galsever.school.ui.act
import com.galsever.school.ui.app
import com.galsever.school.ui.openRemote
import com.galsever.school.ui.rememberLoader
import com.galsever.school.ui.shortTime
import com.galsever.school.ui.sizeText
import com.galsever.school.ui.theme.Sc

/** The class team's main channel: "General" / "Allgemein" by Microsoft's name, else the first. */
fun mainChannel(t: Team) = t.channels.firstOrNull { it.original == "General" || it.original == "Allgemein" } ?: t.channels.firstOrNull()

// ---- teams list -----------------------------------------------------------------------------------

@Composable
fun TeamsScreen() {
    val nav = LocalNav.current
    val teams = rememberLoader("teams") { app.api.teams() }
    val chats = Cache.get<List<Chat>>("chats") ?: emptyList()
    var query by rememberSaveable { mutableStateOf("") }
    var open by rememberSaveable { mutableStateOf(setOf<String>()) }
    var hiddenOpen by rememberSaveable { mutableStateOf(false) }
    var edit by remember { mutableStateOf<Pair<String, String>?>(null) } // id to current name
    var editHidden by remember { mutableStateOf(false) }
    var editOriginal by remember { mutableStateOf("") }

    Column(Modifier.fillMaxSize()) {
        TopBar("Teams")
        SearchField(query, { query = it })
        Content(teams) { list ->
            val q = query.trim()
            fun matches(name: String, original: String) = q.isEmpty() || name.contains(q, true) || original.contains(q, true)
            val shown = list.filter { t -> matches(t.name, t.original) || t.channels.any { matches(it.name, it.original) } }
            val (visible, hidden) = shown.partition { !it.hidden }
            fun LazyListScope.teamItems(items: List<Team>) {
                items(items, key = { it.id }) { t ->
                    val expanded = t.id in open || q.isNotEmpty()
                    val unread = t.channels.any { ch -> chats.any { it.id == ch.id && it.unread } }
                    Column {
                        LongPressRow(
                            onClick = { mainChannel(t)?.let { nav.navigate(Routes.channel(t.id, it.id)) } },
                            onLong = { edit = t.id to t.name; editHidden = t.hidden; editOriginal = t.original },
                        ) {
                            Avatar(t.name, size = 36)
                            Text(
                                t.name,
                                fontWeight = if (unread) FontWeight.SemiBold else FontWeight.Medium,
                                color = if (t.hidden) Sc.mutedFg else Sc.fg,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.weight(1f).padding(start = 12.dp),
                            )
                            if (unread) Dot()
                            IconButton(onClick = { open = if (t.id in open) open - t.id else open + t.id }) {
                                Icon(if (expanded) Icons.Outlined.ExpandLess else Icons.Outlined.ExpandMore, "Channels", tint = Sc.mutedFg)
                            }
                        }
                        if (expanded) t.channels.filter { matches(it.name, it.original) || matches(t.name, t.original) }.forEach { ch ->
                            val chUnread = chats.any { it.id == ch.id && it.unread }
                            LongPressRow(
                                start = 64,
                                onClick = { nav.navigate(Routes.channel(t.id, ch.id)) },
                                onLong = { edit = ch.id to ch.name; editHidden = ch.hidden; editOriginal = ch.original },
                            ) {
                                Icon(Icons.Filled.Tag, null, Modifier.size(16.dp), tint = Sc.mutedFg)
                                Text(
                                    ch.name,
                                    fontSize = 14.sp,
                                    color = if (ch.hidden) Sc.mutedFg else Sc.fg,
                                    fontWeight = if (chUnread) FontWeight.SemiBold else FontWeight.Normal,
                                    modifier = Modifier.weight(1f).padding(start = 8.dp),
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                                if (chUnread) Dot()
                            }
                        }
                    }
                }
            }
            LazyColumn(Modifier.fillMaxSize()) {
                teamItems(visible)
                if (hidden.isNotEmpty()) {
                    item {
                        Row(
                            Modifier.fillMaxWidth().combinedClickable(onClick = { hiddenOpen = !hiddenOpen }).padding(16.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text("Hidden", color = Sc.mutedFg, fontSize = 13.sp, modifier = Modifier.weight(1f))
                            Icon(if (hiddenOpen) Icons.Outlined.ExpandLess else Icons.Outlined.ExpandMore, null, tint = Sc.mutedFg)
                        }
                    }
                    if (hiddenOpen || q.isNotEmpty()) teamItems(hidden)
                }
                if (shown.isEmpty()) item { EmptyText("Nothing found") }
            }
        }
    }

    edit?.let { (id, name) ->
        PrefDialog(id, name, editOriginal, editHidden, onDone = { edit = null; teams.reload() })
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun LongPressRow(start: Int = 16, onClick: () -> Unit, onLong: () -> Unit, content: @Composable androidx.compose.foundation.layout.RowScope.() -> Unit) {
    Row(
        Modifier.fillMaxWidth().combinedClickable(onClick = onClick, onLongClick = onLong).padding(start = start.dp, end = 8.dp, top = 6.dp, bottom = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        content = content,
    )
}

/** Long press on a team or channel: own display name (empty = Microsoft's) and hiding, like the website's right click. */
@Composable
private fun PrefDialog(id: String, name: String, original: String, hidden: Boolean, onDone: () -> Unit) {
    val scope = rememberCoroutineScope()
    val snack = LocalSnack.current
    var value by remember { mutableStateOf(if (name == original) "" else name) }
    AlertDialog(
        onDismissRequest = onDone,
        title = { Text(name, maxLines = 1, overflow = TextOverflow.Ellipsis) },
        text = {
            OutlinedTextField(value, { value = it.take(80) }, singleLine = true, placeholder = { Text(original) }, label = { Text("Rename") })
        },
        confirmButton = {
            TextButton(onClick = { scope.act(snack) { app.api.setPref(id, name = value.trim()); onDone() } }) { Text("Save") }
        },
        dismissButton = {
            TextButton(onClick = { scope.act(snack) { app.api.setPref(id, hidden = !hidden); onDone() } }) { Text(if (hidden) "Show" else "Hide") }
        },
    )
}

// ---- a channel: posts, files, the class's assignments ------------------------------------------------

@Composable
fun ChannelScreen(teamId: String, id: String) {
    val teams = Cache.get<List<Team>>("teams") ?: emptyList()
    val team = teams.firstOrNull { it.id == teamId }
    val channel = team?.channels?.firstOrNull { it.id == id }
    var tab by rememberSaveable { mutableStateOf("posts") }
    val assignments = rememberLoader("assignments") { app.api.assignments() }
    val open = (assignments.data ?: emptyList()).filter { it.classId == teamId && isOpen(it) }
    Column(Modifier.fillMaxSize()) {
        TopBar(channel?.name ?: "Channel", subtitle = team?.name, back = true)
        Row(Modifier.padding(horizontal = 12.dp, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Pill("Posts", tab == "posts") { tab = "posts" }
            Pill("Files", tab == "files") { tab = "files" }
            Pill("Assignments" + if (open.isNotEmpty()) " ${open.size}" else "", tab == "tasks") { tab = "tasks" }
        }
        when (tab) {
            "posts" -> Conversation(id, Modifier.weight(1f))
            "files" -> ChannelFiles(teamId, id)
            else -> ClassAssignments(teamId, assignments.data ?: emptyList())
        }
    }
}

@Composable
private fun ChannelFiles(teamId: String, channelId: String) {
    val folder = rememberLoader("files:$teamId:$channelId") { app.api.channelFiles(teamId, channelId) }
    Content(folder) { f -> FolderList(f.drive, f) }
}

@Composable
private fun ClassAssignments(teamId: String, all: List<Assignment>) {
    val list = all.filter { it.classId == teamId }.sortedWith(compareBy<Assignment> { it.done }.thenBy { it.due ?: "9" })
    if (list.isEmpty()) EmptyText("No assignments")
    LazyColumn(Modifier.fillMaxSize()) { items(list, key = { it.id }) { AssignmentRow(it, showClass = false) } }
}

// ---- files ----------------------------------------------------------------------------------------

@Composable
fun FolderScreen(drive: String, item: String, name: String) {
    val folder = rememberLoader("folder:$drive:$item") { app.api.folder(drive, item) }
    Column(Modifier.fillMaxSize()) {
        TopBar(name.ifBlank { "Folder" }, back = true)
        Content(folder) { FolderList(drive, it) }
    }
}

@Composable
fun FolderList(drive: String, folder: Folder) {
    val nav = LocalNav.current
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val snack = LocalSnack.current
    if (folder.items.isEmpty()) {
        EmptyText("Empty")
        return
    }
    LazyColumn(Modifier.fillMaxSize()) {
        items(folder.items, key = { it.id }) { f: DriveItem ->
            Row(
                Modifier.fillMaxWidth().combinedClickable(
                    onClick = {
                        if (f.folder) nav.navigate(Routes.folder(drive, f.id, f.name))
                        else scope.openRemote(ctx, snack, app.api.fileView(drive, f.id), f.name)
                    },
                    onLongClick = { f.webUrl?.let { Files.openUrl(ctx, it) } },
                ).padding(horizontal = 16.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(if (f.folder) Icons.Outlined.Folder else Icons.Outlined.Description, null, tint = if (f.folder) Sc.primary else Sc.mutedFg)
                Column(Modifier.weight(1f).padding(start = 12.dp)) {
                    Text(f.name, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(
                        listOfNotNull(shortTime(f.modified).ifEmpty { null }, if (f.folder) f.count?.let { "$it items" } else sizeText(f.size)).joinToString("  ·  "),
                        fontSize = 12.sp,
                        color = Sc.mutedFg,
                    )
                }
                if (f.webUrl != null) IconButton(onClick = { Files.openUrl(ctx, f.webUrl) }) {
                    Icon(Icons.Outlined.OpenInNew, "Open in SharePoint", tint = Sc.mutedFg, modifier = Modifier.size(18.dp))
                }
            }
        }
        item { Spacer(Modifier.width(1.dp)) }
    }
}

