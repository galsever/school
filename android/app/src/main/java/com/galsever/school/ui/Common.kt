package com.galsever.school.ui

import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.Tag
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavHostController
import com.galsever.school.App
import com.galsever.school.net.ApiException
import com.galsever.school.ui.theme.Sc
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.util.Locale

val app: App get() = App.instance

val LocalNav = staticCompositionLocalOf<NavHostController> { error("no nav") }
val LocalSnack = staticCompositionLocalOf<SnackbarHostState> { error("no snackbar") }

object Routes {
    const val CHATS = "chats"
    const val TEAMS = "teams"
    const val ASSIGNMENTS = "assignments"
    const val MAIL = "mail"
    const val ABSENCES = "absences"
    const val MOODLE = "moodle"
    const val SETTINGS = "settings"
    const val CONNECT = "connect"
    const val COMPOSE = "mail-compose"
    private fun e(s: String) = Uri.encode(s)
    fun chat(id: String) = "chat/${e(id)}"
    fun channel(teamId: String, id: String) = "channel/${e(teamId)}/${e(id)}"
    fun folder(drive: String, item: String, name: String) = "folder/${e(drive)}/${e(item)}?name=${e(name)}"
    fun assignment(classId: String, id: String) = "assignment/${e(classId)}/${e(id)}"
    fun mail(id: String) = "mail/${e(id)}"
    fun course(id: Long) = "course/$id"
    fun moodleAssignment(cmid: Long, course: Long) = "moodle-assignment/$cmid/$course"
    fun moodlePage(url: String, name: String) = "moodle-page?url=${e(url)}&name=${e(name)}"
}

// ---- loading data -----------------------------------------------------------------------------

/** Last answers per key, so a screen shows its data at once when it opens again (refreshed in the background). */
object Cache {
    private val map = HashMap<String, Any?>()
    @Suppress("UNCHECKED_CAST")
    fun <T> get(key: String): T? = synchronized(map) { map[key] as T? }
    fun put(key: String, value: Any?) = synchronized(map) { map[key] = value }
    /** Drops every key starting with [prefix] ("" = all). */
    fun drop(prefix: String) = synchronized(map) { map.keys.removeAll { it.startsWith(prefix) } }
}

@Stable
class Loader<T>(private val scope: CoroutineScope, val key: String, private val fetch: suspend () -> T) {
    var data by mutableStateOf<T?>(Cache.get(key))
    var error by mutableStateOf<ApiException?>(null)
    var loading by mutableStateOf(false)
    private var job: Job? = null

    fun reload() {
        job?.cancel()
        job = scope.launch {
            loading = true
            try {
                val v = fetch()
                data = v
                error = null
                Cache.put(key, v)
            } catch (e: ApiException) {
                error = e
            } finally {
                loading = false
            }
        }
    }

    /** Local change without a fetch (e.g. after a send). */
    fun set(v: T) {
        data = v
        Cache.put(key, v)
    }
}

/** Loads on first composition and when [key] changes; [every] polls while the screen is shown. */
@Composable
fun <T> rememberLoader(key: String, every: Long? = null, fetch: suspend () -> T): Loader<T> {
    val scope = rememberCoroutineScope()
    val loader = remember(key) { Loader(scope, key, fetch) }
    LaunchedEffect(loader) {
        loader.reload()
        if (every != null) while (isActive) {
            delay(every)
            loader.reload()
        }
    }
    return loader
}

/** Spinner on the first load, error with retry, else [content]. Errors after a successful load keep the old data. */
@Composable
fun <T> Content(loader: Loader<T>, modifier: Modifier = Modifier, content: @Composable (T) -> Unit) {
    val data = loader.data
    when {
        data != null -> content(data)
        loader.error != null -> ErrorBox(loader.error!!, modifier) { loader.reload() }
        else -> Loading(modifier)
    }
}

@Composable
fun Loading(modifier: Modifier = Modifier) {
    Box(modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        CircularProgressIndicator(color = Sc.primary, strokeWidth = 2.dp, modifier = Modifier.size(28.dp))
    }
}

@Composable
fun ErrorBox(e: ApiException, modifier: Modifier = Modifier, retry: () -> Unit) {
    val nav = LocalNav.current
    Column(
        modifier.fillMaxWidth().padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        when (e.code) {
            "ms_not_connected" -> Button(onClick = { nav.navigate(Routes.CONNECT) }) { Text("Connect Microsoft") }
            "moodle_not_connected" -> Button(onClick = { nav.navigate(Routes.SETTINGS) }) { Text("Connect Moodle") }
            "gate_login" -> Text("Signing in", color = Sc.mutedFg)
            else -> {
                Text(e.message, color = Sc.mutedFg, textAlign = TextAlign.Center)
                OutlinedButton(onClick = retry) { Text("Retry") }
            }
        }
    }
}

@Composable
fun EmptyText(text: String, modifier: Modifier = Modifier) {
    Text(text, color = Sc.mutedFg, textAlign = TextAlign.Center, modifier = modifier.fillMaxWidth().padding(40.dp))
}

/** Runs [block], shows an API error as a snackbar. */
fun CoroutineScope.act(snack: SnackbarHostState, block: suspend () -> Unit) = launch {
    try {
        block()
    } catch (e: ApiException) {
        if (e.code != "gate_login") snack.showSnackbar(e.message)
    }
}

/** Calls [tick] every [ms] while the composable is shown. */
@Composable
fun Every(ms: Long, tick: suspend () -> Unit) {
    LaunchedEffect(Unit) {
        while (isActive) {
            delay(ms)
            tick()
        }
    }
}

@Composable
fun OnDispose(block: () -> Unit) {
    DisposableEffect(Unit) { onDispose(block) }
}

// ---- layout pieces --------------------------------------------------------------------------

@Composable
fun TopBar(
    title: String,
    subtitle: String? = null,
    back: Boolean = false,
    onTitle: (() -> Unit)? = null,
    actions: @Composable RowScope.() -> Unit = {},
) {
    val nav = LocalNav.current
    Row(
        Modifier.fillMaxWidth().height(56.dp).padding(horizontal = if (back) 4.dp else 16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (back) IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
        Column(
            Modifier.weight(1f).padding(start = if (back) 4.dp else 0.dp).let { if (onTitle != null) it.clickable(onClick = onTitle) else it },
        ) {
            Text(
                title,
                style = if (back) MaterialTheme.typography.titleMedium else MaterialTheme.typography.titleLarge,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (subtitle != null) Text(subtitle, color = Sc.mutedFg, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        actions()
    }
}

/** The website's pill chips (Open / All, Inbox / Sent ...). */
@Composable
fun Pill(label: String, active: Boolean, onClick: () -> Unit) {
    Box(
        Modifier
            .clip(RoundedCornerShape(50))
            .background(if (active) Sc.primary else Sc.muted)
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 6.dp),
    ) {
        Text(label, fontSize = 12.sp, fontWeight = FontWeight.Medium, color = if (active) Sc.onPrimary else Sc.fg)
    }
}

@Composable
fun SectionTitle(text: String, modifier: Modifier = Modifier) {
    Text(
        text,
        color = Sc.mutedFg,
        fontSize = 12.sp,
        fontWeight = FontWeight.Medium,
        modifier = modifier.padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 6.dp),
    )
}

/** Rounded card like the website's `rounded-xl bg-card`. */
@Composable
fun CardBox(modifier: Modifier = Modifier, onClick: (() -> Unit)? = null, content: @Composable () -> Unit) {
    Box(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(Sc.card)
            .let { if (onClick != null) it.clickable(onClick = onClick) else it }
            .padding(14.dp),
    ) { content() }
}

private val HUES = listOf(Color(0xFF594591), Color(0xFF0E5794), Color(0xFF00676F), Color(0xFF00683D), Color(0xFF8A3819), Color(0xFF8A3346), Color(0xFF793974))

fun initials(name: String): String {
    val parts = name.replace(Regex("\\(.*?\\)"), "").trim().split(Regex("\\s+")).filter { it.isNotEmpty() }
    return ((parts.firstOrNull()?.take(1) ?: "") + (if (parts.size > 1) parts.last().take(1) else "")).uppercase().ifEmpty { "?" }
}

/** Initials (or a channel / meeting / group icon) on a color picked from the name, like the website. */
@Composable
fun Avatar(name: String, kind: String = "chat", size: Int = 40) {
    var h = 0
    for (c in name) h = h * 31 + c.code
    val bg = HUES[Math.floorMod(h, HUES.size)]
    val icon = when {
        kind == "channel" -> Icons.Filled.Tag
        kind == "meeting" -> Icons.Filled.Videocam
        name.contains(",") -> Icons.Filled.Groups
        else -> null
    }
    Box(Modifier.size(size.dp).clip(CircleShape).background(bg), contentAlignment = Alignment.Center) {
        if (icon != null) Icon(icon, null, tint = Color.White, modifier = Modifier.size((size * 0.45).dp))
        else Text(initials(name), color = Color.White, fontSize = (size * 0.35).sp, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
fun Dot(color: Color = Sc.primary, size: Int = 8) {
    Box(Modifier.size(size.dp).clip(CircleShape).background(color))
}

// ---- time ---------------------------------------------------------------------------------

private val zone: ZoneId get() = ZoneId.systemDefault()
private val de = Locale.GERMAN
private val fTime = DateTimeFormatter.ofPattern("HH:mm", de)
private val fDay = DateTimeFormatter.ofPattern("dd.MM.", de)
private val fDayYear = DateTimeFormatter.ofPattern("dd.MM.yy", de)
private val fFull = DateTimeFormatter.ofPattern("EEE, dd.MM., HH:mm", de)
private val fFullYear = DateTimeFormatter.ofPattern("EEE, dd.MM.yyyy, HH:mm", de)

fun parseTime(iso: String?): ZonedDateTime? =
    if (iso.isNullOrEmpty()) null else runCatching { ZonedDateTime.parse(iso).withZoneSameInstant(zone) }.getOrNull()

/** List timestamp: time today, date otherwise (with the year when it is not this year). */
fun shortTime(iso: String?): String {
    val d = parseTime(iso) ?: return ""
    val now = ZonedDateTime.now(zone)
    return when {
        d.toLocalDate() == now.toLocalDate() -> d.format(fTime)
        d.year == now.year -> d.format(fDay)
        else -> d.format(fDayYear)
    }
}

fun longTime(iso: String?): String {
    val d = parseTime(iso) ?: return ""
    return d.format(if (d.year == ZonedDateTime.now(zone).year) fFull else fFullYear)
}

fun clockTime(iso: String?): String = parseTime(iso)?.format(fTime) ?: ""

data class Due(val text: String, val late: Boolean, val soon: Boolean)

/** "Today 23:59", "Tomorrow 08:00", "2 d late" like the website's dueText. */
fun dueText(iso: String?): Due {
    val d = parseTime(iso) ?: return Due("No due date", late = false, soon = false)
    val now = ZonedDateTime.now(zone)
    val days = Math.floorDiv(ChronoUnit.MILLIS.between(now, d), 86_400_000L)
    if (d.isBefore(now)) return Due("${-days} d late", late = true, soon = false)
    return when (days) {
        0L -> Due("Today ${d.format(fTime)}", late = false, soon = true)
        1L -> Due("Tomorrow ${d.format(fTime)}", late = false, soon = true)
        else -> Due(d.format(fFull), late = false, soon = days < 4)
    }
}

/** "2026-10-06" -> "06.10.2026" */
fun dateText(isoDay: String): String = runCatching { LocalDate.parse(isoDay).format(DateTimeFormatter.ofPattern("dd.MM.yyyy")) }.getOrDefault(isoDay)

fun sizeText(bytes: Long?): String {
    if (bytes == null) return ""
    if (bytes < 1024) return "$bytes B"
    if (bytes < 1024 * 1024) return "${bytes / 1024} KB"
    return String.format(Locale.US, "%.1f MB", bytes / 1048576.0)
}
