package com.galsever.school.ui.screens

import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.outlined.AttachFile
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
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
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import com.galsever.school.net.ApiException
import com.galsever.school.net.Chat
import com.galsever.school.net.Message
import com.galsever.school.ui.Avatar
import com.galsever.school.ui.Badges
import com.galsever.school.ui.Cache
import com.galsever.school.ui.Content
import com.galsever.school.ui.Dot
import com.galsever.school.ui.EmptyText
import com.galsever.school.ui.Every
import com.galsever.school.ui.Files
import com.galsever.school.ui.Html
import com.galsever.school.ui.LocalNav
import com.galsever.school.ui.LocalSnack
import com.galsever.school.ui.Routes
import com.galsever.school.ui.TopBar
import com.galsever.school.ui.act
import com.galsever.school.ui.app
import com.galsever.school.ui.clockTime
import com.galsever.school.ui.openRemote
import com.galsever.school.ui.rememberLoader
import com.galsever.school.ui.shortTime
import com.galsever.school.ui.theme.Sc
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filter
import android.content.Context
import androidx.compose.material3.SnackbarHostState
import java.time.ZonedDateTime

// ---- chat list ---------------------------------------------------------------------------------

@Composable
fun ChatsScreen() {
    val nav = LocalNav.current
    val chats = rememberLoader("chats", every = 10_000) { app.api.chats().also { list -> Badges.chats = list.count { it.unread } } }
    var query by rememberSaveable { mutableStateOf("") }
    Column(Modifier.fillMaxSize()) {
        TopBar("Chats")
        SearchField(query, { query = it })
        Content(chats) { list ->
            val shown = list.filter { query.isBlank() || it.title.contains(query.trim(), ignoreCase = true) }
            if (shown.isEmpty()) EmptyText(if (query.isBlank()) "No chats" else "Nothing found")
            LazyColumn(Modifier.fillMaxSize()) {
                items(shown, key = { it.id }) { c -> ChatRow(c) { nav.navigate(Routes.chat(c.id)) } }
            }
        }
    }
}

@Composable
fun SearchField(value: String, onChange: (String) -> Unit, placeholder: String = "Search") {
    TextField(
        value = value,
        onValueChange = onChange,
        singleLine = true,
        placeholder = { Text(placeholder) },
        leadingIcon = { Icon(Icons.Outlined.Search, null, tint = Sc.mutedFg) },
        shape = RoundedCornerShape(12.dp),
        colors = fieldColors(),
        modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp),
    )
}

@Composable
fun fieldColors() = TextFieldDefaults.colors(
    focusedContainerColor = Sc.muted,
    unfocusedContainerColor = Sc.muted,
    disabledContainerColor = Sc.muted,
    focusedIndicatorColor = androidx.compose.ui.graphics.Color.Transparent,
    unfocusedIndicatorColor = androidx.compose.ui.graphics.Color.Transparent,
    disabledIndicatorColor = androidx.compose.ui.graphics.Color.Transparent,
    cursorColor = Sc.primary,
)

@Composable
private fun ChatRow(c: Chat, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Avatar(c.title, c.kind)
        Column(Modifier.weight(1f).padding(start = 12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    c.title,
                    fontWeight = if (c.unread) FontWeight.SemiBold else FontWeight.Medium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                Text(shortTime(c.last?.time), fontSize = 12.sp, color = if (c.unread) Sc.primary else Sc.mutedFg)
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                val last = c.last
                val prefix = when {
                    last == null -> ""
                    last.mine -> "You: "
                    c.kind != "chat" || c.title.contains(",") -> last.from.substringBefore(" ") + ": "
                    else -> ""
                }
                Text(
                    prefix + (last?.text ?: ""),
                    fontSize = 13.sp,
                    color = if (c.unread) Sc.fg else Sc.mutedFg,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                if (c.unread) {
                    Spacer(Modifier.width(8.dp))
                    Dot()
                }
            }
        }
    }
}

// ---- one chat or channel ---------------------------------------------------------------------------

@Composable
fun ConversationScreen(id: String) {
    val chat = (Cache.get<List<Chat>>("chats") ?: emptyList()).firstOrNull { it.id == id }
    Column(Modifier.fillMaxSize()) {
        TopBar(chat?.title ?: "Chat", back = true)
        Conversation(id, Modifier.weight(1f))
    }
}

/**
 * Messages of a chat or channel, newest at the bottom: the latest page is polled every 4 s and merged with the older
 * pages loaded while scrolling up. Sending shows the message at once; opening marks it read.
 */
@Composable
fun Conversation(id: String, modifier: Modifier = Modifier) {
    val scope = rememberCoroutineScope()
    val snack = LocalSnack.current
    val ctx = LocalContext.current
    val nav = LocalNav.current
    val messages = remember(id) { mutableStateListOf<Message>().apply { addAll(Cache.get<List<Message>>("messages:$id") ?: emptyList()) } }
    var cursor by remember(id) { mutableStateOf<String?>(null) }
    var first by remember(id) { mutableStateOf(true) }
    var error by remember(id) { mutableStateOf<ApiException?>(null) }
    var loadingOlder by remember(id) { mutableStateOf(false) }
    var lastRead by remember(id) { mutableStateOf<String?>(null) }

    fun merge(page: List<Message>) {
        val byId = LinkedHashMap<String, Message>()
        (messages + page).forEach { byId[it.id] = it }
        val sorted = byId.values.sortedBy { it.time }
        messages.clear()
        messages.addAll(sorted)
        Cache.put("messages:$id", sorted.takeLast(60))
    }

    suspend fun latest() {
        try {
            val page = app.api.messages(id)
            if (first) cursor = page.cursor
            first = false
            error = null
            merge(page.messages)
            val newest = messages.lastOrNull { !it.mine }
            if (newest != null && newest.id != lastRead) {
                lastRead = newest.id
                runCatching { app.api.markRead(id, newest.id) }
            }
        } catch (e: ApiException) {
            if (messages.isEmpty()) error = e
        }
    }

    LaunchedEffect(id) { latest() }
    Every(4_000) { latest() }

    val list = rememberLazyListState()
    val shown = messages.filter { !it.deleted }.asReversed()
    // older page when the top (the end of the reversed list) comes into view
    val atTop by remember { derivedStateOf { list.layoutInfo.visibleItemsInfo.lastOrNull()?.index?.let { it >= list.layoutInfo.totalItemsCount - 3 } ?: false } }
    LaunchedEffect(atTop, cursor) {
        val c = cursor
        if (atTop && c != null && !loadingOlder && !first) {
            loadingOlder = true
            try {
                val page = app.api.messages(id, c)
                cursor = page.cursor
                merge(page.messages)
            } catch (_: ApiException) {
            }
            loadingOlder = false
        }
    }

    Column(modifier.fillMaxSize()) {
        Box(Modifier.weight(1f)) {
            when {
                error != null && messages.isEmpty() -> com.galsever.school.ui.ErrorBox(error!!) { scope.act(snack) { latest() } }
                first && messages.isEmpty() -> com.galsever.school.ui.Loading()
                shown.isEmpty() -> EmptyText("No messages")
                else -> LazyColumn(Modifier.fillMaxSize(), state = list, reverseLayout = true, contentPadding = androidx.compose.foundation.layout.PaddingValues(vertical = 8.dp)) {
                    items(shown.size, key = { shown[it].id }) { i ->
                        val m = shown[i]
                        val older = shown.getOrNull(i + 1)
                        val grouped = older != null && older.fromId == m.fromId && older.subject == null && m.subject == null &&
                            minutesBetween(older.time, m.time) < 5
                        MessageBubble(m, showName = !m.mine && !grouped, ctx = ctx, scope = scope, snack = snack) { classId, aid ->
                            nav.navigate(Routes.assignment(classId, aid))
                        }
                    }
                }
            }
        }
        Composer { text ->
            scope.act(snack) {
                val sent = app.api.sendMessage(id, text)
                merge(listOf(Message(id = sent.id.ifEmpty { "local-" + System.nanoTime() }, mine = true, time = java.time.Instant.now().toString(), html = text, format = "text")))
                latest()
            }
        }
    }
}

private fun minutesBetween(a: String, b: String): Long =
    runCatching { java.time.Duration.between(ZonedDateTime.parse(a), ZonedDateTime.parse(b)).toMinutes() }.getOrDefault(99)

@Composable
private fun MessageBubble(
    m: Message,
    showName: Boolean,
    ctx: Context,
    scope: CoroutineScope,
    snack: SnackbarHostState,
    openAssignment: (String, String) -> Unit,
) {
    val content = remember(m.id, m.html) { if (m.format == "html") Html.chat(m.html) else Html.Chat(androidx.compose.ui.text.AnnotatedString(m.html), emptyList()) }
    Column(
        Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = if (showName) 6.dp else 2.dp),
        horizontalAlignment = if (m.mine) Alignment.End else Alignment.Start,
    ) {
        if (showName) Text("${m.from}  ·  ${clockTime(m.time)}", fontSize = 11.sp, color = Sc.mutedFg, modifier = Modifier.padding(start = 4.dp, bottom = 2.dp))
        Column(
            Modifier
                .widthIn(max = 320.dp)
                .clip(RoundedCornerShape(14.dp))
                .background(if (m.mine) Sc.mine else Sc.bubble)
                .padding(horizontal = 12.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            m.subject?.takeIf { it.isNotBlank() }?.let { Text(it, fontWeight = FontWeight.SemiBold) }
            if (content.text.isNotEmpty()) Text(content.text, fontSize = 15.sp)
            content.images.forEach { src ->
                AsyncImage(
                    model = src,
                    contentDescription = null,
                    contentScale = ContentScale.FillWidth,
                    modifier = Modifier.fillMaxWidth().heightIn(max = 320.dp).clip(RoundedCornerShape(8.dp))
                        .clickable { scope.openRemote(ctx, snack, src, "image.png") },
                )
            }
            m.cards.forEach { card ->
                Column(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(Sc.accent).padding(10.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    card.blocks.forEach { b ->
                        Text(
                            b.text,
                            fontWeight = if (b.bold) FontWeight.SemiBold else FontWeight.Normal,
                            fontSize = if (b.size == "large" || b.size == "extraLarge") 17.sp else 14.sp,
                            color = if (b.subtle) Sc.mutedFg else Sc.fg,
                        )
                    }
                    card.images.forEach { AsyncImage(it, null, Modifier.fillMaxWidth().heightIn(max = 200.dp)) }
                    card.actions.forEach { a ->
                        OutlinedButton(onClick = {
                            val ref = a.assignment
                            if (ref != null) openAssignment(ref.classId, ref.id) else Files.openUrl(ctx, a.url)
                        }) { Text(a.title.ifBlank { "Open" }, maxLines = 1) }
                    }
                }
            }
            m.files.forEach { f ->
                Row(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(Sc.accent)
                        .clickable { f.url?.let { openResource(ctx, scope, snack, it, f.name) } }
                        .padding(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(Icons.Outlined.AttachFile, null, Modifier.size(16.dp), tint = Sc.mutedFg)
                    Text(f.name, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(start = 6.dp))
                }
            }
            if (!showName || m.mine) Text(
                clockTime(m.time) + if (m.edited) "  · edited" else "",
                fontSize = 10.sp,
                color = Sc.mutedFg,
                modifier = Modifier.align(Alignment.End),
            )
        }
    }
}

/**
 * A file or resource link from Teams: Graph drive items open through the hub (Office files arrive as PDF),
 * anything else in the browser. /api/files/open would answer with a redirect, which the app reads as a login.
 */
fun openResource(ctx: Context, scope: CoroutineScope, snack: SnackbarHostState, url: String, name: String) {
    var u = url
    if (u.startsWith("/api/files/open?url=")) u = Uri.decode(u.substringAfter("url="))
    val m = Regex("/drives/([^/]+)/items/([^/?]+)").find(u)
    when {
        m != null -> scope.openRemote(ctx, snack, app.api.fileView(Uri.decode(m.groupValues[1]), Uri.decode(m.groupValues[2])), name)
        u.startsWith("/api/") -> scope.openRemote(ctx, snack, u, name)
        else -> Files.openUrl(ctx, u)
    }
}

@Composable
private fun Composer(send: (String) -> Unit) {
    var text by rememberSaveable { mutableStateOf("") }
    Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.Bottom) {
        TextField(
            value = text,
            onValueChange = { text = it },
            placeholder = { Text("Message") },
            shape = RoundedCornerShape(20.dp),
            colors = fieldColors(),
            maxLines = 6,
            modifier = Modifier.weight(1f),
        )
        IconButton(
            enabled = text.isNotBlank(),
            onClick = {
                send(text.trim())
                text = ""
            },
        ) { Icon(Icons.AutoMirrored.Filled.Send, "Send", tint = if (text.isNotBlank()) Sc.primary else Sc.mutedFg) }
    }
}
