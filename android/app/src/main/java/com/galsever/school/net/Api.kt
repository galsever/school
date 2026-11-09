package com.galsever.school.net

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File

/** status 0 = offline; code as in docs/API.md ("ms_not_connected", "moodle_not_connected", "letter", ...) or "gate_login". */
class ApiException(val status: Int, val code: String, override val message: String) : Exception(message)

/** Thin client for docs/API.md. Redirects are not followed: a 3xx means the Pocket ID gate wants a login. */
class Api(private val http: OkHttpClient) {
    val json = Json { ignoreUnknownKeys = true; explicitNulls = false; coerceInputValues = true }

    /** Fires when the gate session is missing or expired; MainActivity starts the login. */
    val gateLogin = MutableSharedFlow<Unit>(extraBufferCapacity = 1, onBufferOverflow = BufferOverflow.DROP_OLDEST)

    private val jsonType = "application/json".toMediaType()
    private val octets = "application/octet-stream".toMediaType()

    private suspend fun <T> exec(req: Request, read: (okhttp3.Response) -> T): T = withContext(Dispatchers.IO) {
        val res = try {
            http.newCall(req).execute()
        } catch (e: Exception) {
            throw ApiException(0, "network", "Offline")
        }
        res.use {
            val type = it.header("Content-Type").orEmpty()
            if (it.isRedirect || (type.startsWith("text/html") && req.url.encodedPath.startsWith("/api/"))) {
                gateLogin.tryEmit(Unit)
                throw ApiException(401, "gate_login", "Not signed in")
            }
            if (!it.isSuccessful) {
                val body = it.body?.string().orEmpty()
                val err = runCatching { json.parseToJsonElement(body) as JsonObject }.getOrNull()
                val code = (err?.get("error") as? JsonPrimitive)?.content ?: "http_${it.code}"
                val detail = (err?.get("detail") as? JsonPrimitive)?.content ?: "Error ${it.code}"
                throw ApiException(it.code, code, detail)
            }
            read(it)
        }
    }

    private suspend fun call(req: Request): String = exec(req) { it.body?.string().orEmpty() }

    fun url(path: String, vararg q: Pair<String, String?>) =
        absolute(path).toHttpUrl().newBuilder().apply { q.forEach { (k, v) -> if (v != null) addQueryParameter(k, v) } }.build()

    private suspend inline fun <reified T> get(path: String, vararg q: Pair<String, String?>): T =
        json.decodeFromString(call(Request.Builder().url(url(path, *q)).build()))

    private suspend fun send(method: String, path: String, body: JsonObject? = null, vararg q: Pair<String, String?>): String =
        call(Request.Builder().url(url(path, *q)).method(method, (body?.toString() ?: "{}").toRequestBody(jsonType)).build())

    private suspend fun post(path: String, body: JsonObject? = null, vararg q: Pair<String, String?>) = send("POST", path, body, *q)

    private suspend fun delete(path: String) =
        call(Request.Builder().url(url(path)).delete().build())

    private suspend fun upload(path: String, body: RequestBody, vararg q: Pair<String, String?>): String =
        call(Request.Builder().url(url(path, *q)).post(body).build())

    private fun e(s: String) = java.net.URLEncoder.encode(s, "UTF-8").replace("+", "%20")

    /** GET of a file into [target]; returns the server's file name (Content-Disposition) and type. */
    suspend fun download(path: String, target: File): Pair<String?, String> =
        exec(Request.Builder().url(absolute(path)).build()) { res ->
            target.parentFile?.mkdirs()
            res.body!!.byteStream().use { input -> target.outputStream().use { input.copyTo(it) } }
            val name = res.header("Content-Disposition")?.let { cd ->
                Regex("filename\\*=UTF-8''([^;]+)").find(cd)?.groupValues?.get(1)?.let { java.net.URLDecoder.decode(it, "UTF-8") }
                    ?: Regex("filename=\"?([^\";]+)\"?").find(cd)?.groupValues?.get(1)
            }
            name to (res.header("Content-Type")?.substringBefore(";") ?: "application/octet-stream")
        }

    // ---- account
    suspend fun msStatus(): MsStatus = get("/api/ms/status")
    suspend fun msDevice(): DeviceLogin = json.decodeFromString(post("/api/ms/device"))
    suspend fun msDeviceState(): DeviceLogin = get("/api/ms/device")
    suspend fun msLogout() { post("/api/ms/logout") }

    // ---- chats
    suspend fun chats(): List<Chat> = get("/api/chats")
    suspend fun messages(id: String, cursor: String? = null): MessagePage = get("/api/chats/${e(id)}/messages", "cursor" to cursor)
    suspend fun sendMessage(id: String, text: String): Sent =
        json.decodeFromString(post("/api/chats/${e(id)}/messages", buildJsonObject { put("text", text) }))
    suspend fun markRead(id: String, messageId: String) { post("/api/chats/${e(id)}/read", buildJsonObject { put("messageId", messageId) }) }

    // ---- teams and files
    suspend fun teams(): List<Team> = get("/api/teams")
    suspend fun setPref(id: String, name: String? = null, hidden: Boolean? = null) {
        send("PUT", "/api/prefs/${e(id)}", buildJsonObject {
            if (name != null) put("name", name)
            if (hidden != null) put("hidden", hidden)
        })
    }
    suspend fun channelFiles(teamId: String, channelId: String): Folder = get("/api/teams/${e(teamId)}/channels/${e(channelId)}/files")
    suspend fun folder(drive: String, item: String): Folder = get("/api/drives/${e(drive)}/items/${e(item)}/children")
    fun fileView(drive: String, item: String) = "/api/drives/${e(drive)}/items/${e(item)}/view"

    // ---- assignments
    suspend fun assignments(): List<Assignment> = get("/api/assignments")
    suspend fun assignment(classId: String, id: String): Assignment = get("/api/assignments/${e(classId)}/${e(id)}")
    suspend fun uploadWork(classId: String, id: String, name: String, file: File): Resource =
        json.decodeFromString(upload("/api/assignments/${e(classId)}/${e(id)}/files", file.asRequestBody(octets), "name" to name))
    suspend fun removeWork(classId: String, id: String, rid: String) { delete("/api/assignments/${e(classId)}/${e(id)}/files/${e(rid)}") }
    suspend fun turnIn(classId: String, id: String) { post("/api/assignments/${e(classId)}/${e(id)}/turn-in") }
    suspend fun undoTurnIn(classId: String, id: String) { post("/api/assignments/${e(classId)}/${e(id)}/undo-turn-in") }

    // ---- mail
    suspend fun mailList(folder: String, q: String, cursor: String? = null, unread: Boolean = false): MailPage =
        get("/api/mail", "folder" to folder, "q" to q.ifBlank { null }, "cursor" to cursor, "unread" to if (unread) "true" else null)
    suspend fun mailUnread(): Count = get("/api/mail/unread")
    suspend fun mail(id: String): Mail = get("/api/mail/${e(id)}")
    suspend fun mailPeople(q: String): List<MailAddress> = get("/api/mail/people", "q" to q)
    suspend fun mailSend(to: List<String>, cc: List<String>, subject: String, text: String) {
        post("/api/mail/send", buildJsonObject {
            putJsonArray("to") { to.forEach { add(it) } }
            putJsonArray("cc") { cc.forEach { add(it) } }
            put("subject", subject)
            put("text", text)
        })
    }
    suspend fun mailReply(id: String, text: String, all: Boolean) {
        post("/api/mail/${e(id)}/reply", buildJsonObject { put("text", text); put("all", all) })
    }

    // ---- absences
    suspend fun absences(): Absences = get("/api/absences")
    suspend fun absencesSync(force: Boolean): AbsenceSync = json.decodeFromString(post("/api/absences/sync", null, "force" to force.toString()))
    suspend fun setReason(date: String, reason: String) { send("PUT", "/api/absences/$date/reason", buildJsonObject { put("reason", reason) }) }
    /** The Entschuldigung PDF for these days into [target]; returns the file name. */
    suspend fun letter(dates: List<String>, target: File): String =
        exec(Request.Builder().url(url("/api/absences/letter"))
            .post(buildJsonObject { putJsonArray("dates") { dates.forEach { add(it) } } }.toString().toRequestBody(jsonType)).build()) { res ->
            target.parentFile?.mkdirs()
            res.body!!.byteStream().use { input -> target.outputStream().use { input.copyTo(it) } }
            Regex("filename=\"([^\"]+)\"").find(res.header("Content-Disposition").orEmpty())?.groupValues?.get(1) ?: "Entschuldigung.pdf"
        }
    suspend fun attendance(range: String?, from: String?, to: String?): Attendance =
        get("/api/absences/attendance", "range" to (range ?: ""), "from" to from, "to" to to)
    suspend fun saveGroup(name: String, subjects: List<String>) {
        post("/api/absences/groups", buildJsonObject { put("name", name); putJsonArray("subjects") { subjects.forEach { add(it) } } })
    }
    suspend fun deleteGroup(name: String) { delete("/api/absences/groups/${e(name)}") }
    suspend fun untisLogin(): UntisLogin = get("/api/absences/login")
    suspend fun saveUntisLogin(server: String, school: String, user: String, password: String, place: String) {
        post("/api/absences/login", buildJsonObject {
            put("server", server); put("school", school); put("user", user); put("password", password); put("place", place)
        })
    }

    // ---- moodle
    suspend fun moodle(): MoodleHome = get("/api/moodle")
    suspend fun moodleRefresh() { post("/api/moodle/refresh") }
    suspend fun moodleCourse(id: Long): MoodleCourseContent = get("/api/moodle/courses/$id")
    suspend fun moodleGrades(id: Long): List<MoodleGrade> = get("/api/moodle/courses/$id/grades")
    suspend fun moodleAssignment(cmid: Long, course: Long): MoodleAssignment = get("/api/moodle/assignments/$cmid", "course" to course.toString())
    suspend fun moodlePage(url: String): HtmlBody = get("/api/moodle/page", "url" to url)
    suspend fun moodleUpload(name: String, file: File): MoodleUpload =
        json.decodeFromString(upload("/api/moodle/uploads", file.asRequestBody(octets), "name" to name))
    suspend fun moodleChange(cmid: Long, course: Long, add: List<String> = emptyList(), remove: List<String> = emptyList(), text: String? = null): MoodleAssignment =
        json.decodeFromString(post("/api/moodle/assignments/$cmid/submission", buildJsonObject {
            putJsonArray("add") { add.forEach { add(it) } }
            putJsonArray("remove") { remove.forEach { add(it) } }
            if (text != null) put("text", text)
        }, "course" to course.toString()))
    suspend fun moodleSubmit(cmid: Long, course: Long): MoodleAssignment =
        json.decodeFromString(post("/api/moodle/assignments/$cmid/submit", null, "course" to course.toString()))
    fun moodleFile(url: String) = "/api/moodle/file?url=${e(url)}"
    suspend fun moodleLogin(): MoodleLogin = get("/api/moodle/login")
    suspend fun saveMoodleLogin(user: String, password: String) {
        post("/api/moodle/login", buildJsonObject { put("user", user); put("password", password) })
    }
}
