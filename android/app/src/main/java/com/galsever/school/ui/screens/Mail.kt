package com.galsever.school.ui.screens

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Reply
import androidx.compose.material.icons.automirrored.outlined.ReplyAll
import androidx.compose.material.icons.outlined.AttachFile
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.MoreHoriz
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
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
import com.galsever.school.net.ApiException
import com.galsever.school.net.Mail
import com.galsever.school.net.MailAddress
import com.galsever.school.ui.Badges
import com.galsever.school.ui.Cache
import com.galsever.school.ui.CardBox
import com.galsever.school.ui.Content
import com.galsever.school.ui.Dot
import com.galsever.school.ui.EmptyText
import com.galsever.school.ui.ErrorBox
import com.galsever.school.ui.Html
import com.galsever.school.ui.HtmlView
import com.galsever.school.ui.Loading
import com.galsever.school.ui.LocalNav
import com.galsever.school.ui.LocalSnack
import com.galsever.school.ui.Pill
import com.galsever.school.ui.Routes
import com.galsever.school.ui.TopBar
import com.galsever.school.ui.act
import com.galsever.school.ui.app
import com.galsever.school.ui.longTime
import com.galsever.school.ui.openRemote
import com.galsever.school.ui.rememberLoader
import com.galsever.school.ui.shortTime
import com.galsever.school.ui.sizeText
import com.galsever.school.ui.theme.Sc
import kotlinx.coroutines.delay

private val FOLDERS = listOf("inbox" to "Inbox", "sent" to "Sent", "archive" to "Archive")

// ---- list ---------------------------------------------------------------------------------------

@Composable
fun MailScreen() {
    val nav = LocalNav.current
    var folder by rememberSaveable { mutableStateOf("inbox") }
    var query by rememberSaveable { mutableStateOf("") }
    var search by rememberSaveable { mutableStateOf("") }
    LaunchedEffect(query) {
        delay(400)
        search = query.trim()
    }
    val key = "mail:$folder:$search"
    val messages = remember(key) { mutableStateListOf<Mail>().apply { addAll(Cache.get<List<Mail>>(key) ?: emptyList()) } }
    var cursor by remember(key) { mutableStateOf<String?>(null) }
    var loaded by remember(key) { mutableStateOf(false) }
    var loadingMore by remember(key) { mutableStateOf(false) }
    var error by remember(key) { mutableStateOf<ApiException?>(null) }

    suspend fun first() {
        try {
            val page = app.api.mailList(folder, search)
            messages.clear()
            messages.addAll(page.messages)
            cursor = page.cursor
            loaded = true
            error = null
            Cache.put(key, page.messages)
            if (folder == "inbox" && search.isEmpty()) runCatching { Badges.mail = app.api.mailUnread().count }
        } catch (e: ApiException) {
            error = e
        }
    }
    LaunchedEffect(key) {
        first()
        while (true) {
            delay(60_000)
            first()
        }
    }

    val list = rememberLazyListState()
    val nearEnd by remember { derivedStateOf { (list.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0) >= list.layoutInfo.totalItemsCount - 5 } }
    LaunchedEffect(nearEnd, cursor) {
        val c = cursor
        if (nearEnd && c != null && !loadingMore && loaded) {
            loadingMore = true
            try {
                val page = app.api.mailList(folder, search, c)
                messages.addAll(page.messages.filter { m -> messages.none { it.id == m.id } })
                cursor = page.cursor
            } catch (_: ApiException) {
            }
            loadingMore = false
        }
    }

    Column(Modifier.fillMaxSize()) {
        TopBar("Mail") {
            IconButton(onClick = { nav.navigate(Routes.COMPOSE) }) { Icon(Icons.Outlined.Edit, "New mail") }
        }
        Row(Modifier.padding(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FOLDERS.forEach { (id, label) -> Pill(label, folder == id) { folder = id } }
        }
        SearchField(query, { query = it })
        when {
            !loaded && error != null -> ErrorBox(error!!) { }
            !loaded && messages.isEmpty() -> Loading()
            messages.isEmpty() -> EmptyText(if (search.isEmpty()) "No mail" else "Nothing found")
            else -> LazyColumn(Modifier.fillMaxSize(), state = list) {
                itemsIndexed(messages, key = { _, m -> m.id }) { _, m ->
                    MailRow(m, sent = folder == "sent") {
                        // opening marks it read on the server: show that at once
                        val i = messages.indexOfFirst { it.id == m.id }
                        if (i >= 0 && !m.read) {
                            messages[i] = m.copy(read = true)
                            if (Badges.mail > 0) Badges.mail--
                        }
                        nav.navigate(Routes.mail(m.id))
                    }
                }
            }
        }
    }
}

@Composable
private fun MailRow(m: Mail, sent: Boolean, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 16.dp, vertical = 10.dp)) {
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (!m.read) {
                    Dot()
                    Spacer(Modifier.width(6.dp))
                }
                Text(
                    if (sent) m.to.joinToString(", ") { it.name.ifBlank { it.address } } else m.from.name.ifBlank { m.from.address },
                    fontWeight = if (m.read) FontWeight.Medium else FontWeight.Bold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                if (m.attachments) Icon(Icons.Outlined.AttachFile, null, Modifier.size(14.dp), tint = Sc.mutedFg)
                Text(shortTime(m.time), fontSize = 12.sp, color = Sc.mutedFg, modifier = Modifier.padding(start = 6.dp))
            }
            Text(m.subject.ifBlank { "(no subject)" }, fontSize = 14.sp, fontWeight = if (m.read) FontWeight.Normal else FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(m.preview, fontSize = 13.sp, color = Sc.mutedFg, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

// ---- reading -------------------------------------------------------------------------------------

@Composable
fun MailReaderScreen(id: String) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val snack = LocalSnack.current
    val mail = rememberLoader("mail-item:$id") { app.api.mail(id) }
    var images by rememberSaveable { mutableStateOf(false) }
    var quoted by rememberSaveable { mutableStateOf(false) }
    var allTo by rememberSaveable { mutableStateOf(false) }
    var reply by rememberSaveable { mutableStateOf<Boolean?>(null) } // null = closed, false = reply, true = reply all
    var replyText by rememberSaveable { mutableStateOf("") }
    var sending by remember { mutableStateOf(false) }

    Column(Modifier.fillMaxSize()) {
        TopBar(mail.data?.subject?.ifBlank { "(no subject)" } ?: "Mail", back = true)
        Content(mail) { m ->
            val forward = Regex("^(fwd?|wg|tr):", RegexOption.IGNORE_CASE).containsMatchIn(m.subject.trim())
            val body = remember(m.id, images) { Html.rich(m.html, images = images, collapse = !forward) }
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Column {
                    Text(m.from.name.ifBlank { m.from.address }, fontWeight = FontWeight.SemiBold)
                    Text(m.from.address, fontSize = 12.sp, color = Sc.mutedFg)
                    val people = m.to + m.cc
                    Text(
                        if (allTo) "To " + m.to.joinToString(", ") { "${it.name} <${it.address}>" } + (if (m.cc.isNotEmpty()) "\nCc " + m.cc.joinToString(", ") { "${it.name} <${it.address}>" } else "")
                        else "To " + people.joinToString(", ") { it.name.ifBlank { it.address } },
                        fontSize = 12.sp,
                        color = Sc.mutedFg,
                        maxLines = if (allTo) 20 else 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.clickable { allTo = !allTo },
                    )
                    Text(longTime(m.time), fontSize = 12.sp, color = Sc.mutedFg)
                }
                if (body.blocked > 0 && !images) OutlinedButton(onClick = { images = true }) { Text("Show images") }
                HtmlView(body.main, remote = images)
                if (body.quoted != null) {
                    if (quoted) HtmlView(body.quoted, remote = images)
                    else IconButton(onClick = { quoted = true }) { Icon(Icons.Outlined.MoreHoriz, "Show earlier mails", tint = Sc.mutedFg) }
                }
                m.files.forEach { f ->
                    CardBox(onClick = { scope.openRemote(ctx, snack, f.url, f.name) }) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Outlined.AttachFile, null, tint = Sc.mutedFg, modifier = Modifier.size(18.dp))
                            Text(f.name, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f).padding(start = 8.dp))
                            Text(sizeText(f.size), fontSize = 12.sp, color = Sc.mutedFg)
                        }
                    }
                }
                if (reply == null) Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = { reply = false }) { Icon(Icons.AutoMirrored.Outlined.Reply, null, Modifier.size(18.dp)); Text(" Reply") }
                    if (m.to.size + m.cc.size > 1) OutlinedButton(onClick = { reply = true }) {
                        Icon(Icons.AutoMirrored.Outlined.ReplyAll, null, Modifier.size(18.dp)); Text(" Reply all")
                    }
                } else {
                    TextField(
                        value = replyText,
                        onValueChange = { replyText = it },
                        placeholder = { Text(if (reply == true) "Reply all" else "Reply") },
                        colors = fieldColors(),
                        shape = RoundedCornerShape(12.dp),
                        modifier = Modifier.fillMaxWidth().heightIn(min = 120.dp),
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        TextButton(onClick = { reply = null; replyText = "" }) { Text("Cancel") }
                        Button(
                            enabled = replyText.isNotBlank() && !sending,
                            onClick = {
                                sending = true
                                scope.act(snack) {
                                    try {
                                        app.api.mailReply(m.id, replyText.trim(), reply == true)
                                        reply = null
                                        replyText = ""
                                        snack.showSnackbar("Sent")
                                    } finally {
                                        sending = false
                                    }
                                }
                            },
                        ) { Text("Send") }
                    }
                }
                Spacer(Modifier.size(24.dp))
            }
        }
    }
}

// ---- new mail ----------------------------------------------------------------------------------

@Composable
fun ComposeMailScreen() {
    val nav = LocalNav.current
    val scope = rememberCoroutineScope()
    val snack = LocalSnack.current
    var to by rememberSaveable { mutableStateOf("") }
    var cc by rememberSaveable { mutableStateOf("") }
    var subject by rememberSaveable { mutableStateOf("") }
    var text by rememberSaveable { mutableStateOf("") }
    var sending by remember { mutableStateOf(false) }
    var discard by remember { mutableStateOf(false) }
    val dirty = to.isNotBlank() || cc.isNotBlank() || subject.isNotBlank() || text.isNotBlank()
    BackHandler(enabled = dirty && !sending) { discard = true }

    fun split(v: String) = v.split(Regex("[,;\\s]+")).filter { it.contains("@") }

    Column(Modifier.fillMaxSize()) {
        TopBar("New mail", back = true) {
            Button(
                enabled = split(to).isNotEmpty() && !sending,
                onClick = {
                    sending = true
                    scope.act(snack) {
                        try {
                            app.api.mailSend(split(to), split(cc), subject.trim(), text.trim())
                            nav.popBackStack()
                            snack.showSnackbar("Sent")
                        } finally {
                            sending = false
                        }
                    }
                },
                modifier = Modifier.padding(end = 8.dp),
            ) { Text("Send") }
        }
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            AddressField("To", to) { to = it }
            AddressField("Cc", cc) { cc = it }
            TextField(subject, { subject = it }, placeholder = { Text("Subject") }, singleLine = true, colors = fieldColors(), shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth())
            TextField(text, { text = it }, placeholder = { Text("Text") }, colors = fieldColors(), shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth().heightIn(min = 240.dp))
        }
    }

    if (discard) AlertDialog(
        onDismissRequest = { discard = false },
        title = { Text("Discard this mail?") },
        confirmButton = { TextButton(onClick = { discard = false; nav.popBackStack() }) { Text("Discard") } },
        dismissButton = { TextButton(onClick = { discard = false }) { Text("Keep writing") } },
    )
}

/** Addresses separated by commas; from 2 characters the school directory suggests people for the last one. */
@Composable
private fun AddressField(label: String, value: String, onChange: (String) -> Unit) {
    val last = value.substringAfterLast(",").trim()
    var hits by remember { mutableStateOf<List<MailAddress>>(emptyList()) }
    LaunchedEffect(last) {
        hits = emptyList()
        if (last.length >= 2 && !last.contains("@")) {
            delay(250)
            hits = runCatching { app.api.mailPeople(last) }.getOrDefault(emptyList()).take(6)
        }
    }
    Column {
        TextField(value, onChange, placeholder = { Text(label) }, singleLine = true, colors = fieldColors(), shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth())
        hits.forEach { p ->
            Column(
                Modifier.fillMaxWidth().clickable {
                    val head = value.substringBeforeLast(",", "").trim()
                    onChange((if (head.isEmpty()) "" else "$head, ") + p.address + ", ")
                    hits = emptyList()
                }.padding(horizontal = 12.dp, vertical = 8.dp),
            ) {
                Text(p.name, fontSize = 14.sp)
                Text(p.address, fontSize = 12.sp, color = Sc.mutedFg)
            }
        }
    }
}
