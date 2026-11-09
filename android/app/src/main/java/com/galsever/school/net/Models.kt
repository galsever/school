package com.galsever.school.net

import kotlinx.serialization.Serializable

// Shapes of docs/API.md (the website's web/src/lib/types.ts, absences.ts and moodle.ts).

@Serializable data class Me(val id: String = "", val name: String = "", val mail: String = "")
@Serializable data class DeviceLogin(val state: String = "none", val userCode: String? = null, val url: String? = null, val expiresAt: Long? = null)
@Serializable data class MsStatus(val connected: Boolean = false, val me: Me? = null, val device: DeviceLogin? = null)

// ---- chats -----------------------------------------------------------------------------

@Serializable data class LastMessage(val text: String = "", val from: String = "", val time: String = "", val mine: Boolean = false)
@Serializable data class Chat(val id: String, val kind: String = "chat", val title: String = "", val last: LastMessage? = null, val unread: Boolean = false)

@Serializable data class CardBlock(val text: String = "", val size: String = "", val bold: Boolean = false, val subtle: Boolean = false)
@Serializable data class AssignmentRef(val classId: String, val id: String)
@Serializable data class CardAction(val title: String = "", val url: String = "", val assignment: AssignmentRef? = null)
@Serializable data class MsgCard(val blocks: List<CardBlock> = emptyList(), val images: List<String> = emptyList(), val actions: List<CardAction> = emptyList())
@Serializable data class MessageFile(val name: String = "", val url: String? = null, val type: String = "", val size: Long? = null)
@Serializable data class Message(
    val id: String,
    val fromId: String = "",
    val from: String = "",
    val mine: Boolean = false,
    val time: String = "",
    val html: String = "",
    val format: String = "html",
    val edited: Boolean = false,
    val deleted: Boolean = false,
    val subject: String? = null,
    val cards: List<MsgCard> = emptyList(),
    val files: List<MessageFile> = emptyList(),
)
@Serializable data class MessagePage(val messages: List<Message> = emptyList(), val cursor: String? = null)
@Serializable data class Sent(val id: String = "", val clientId: String = "")

// ---- teams and files ----------------------------------------------------------------------

@Serializable data class Channel(val id: String, val name: String = "", val original: String = "", val hidden: Boolean = false)
@Serializable data class Team(
    val id: String,
    val name: String = "",
    val original: String = "",
    val hidden: Boolean = false,
    val channels: List<Channel> = emptyList(),
)
@Serializable data class DriveItem(
    val id: String,
    val name: String = "",
    val folder: Boolean = false,
    val count: Int? = null,
    val size: Long? = null,
    val modified: String? = null,
    val webUrl: String? = null,
)
@Serializable data class Folder(val items: List<DriveItem> = emptyList(), val drive: String = "", val id: String = "", val name: String = "", val webUrl: String? = null)

// ---- assignments --------------------------------------------------------------------------

@Serializable data class Resource(val id: String = "", val name: String = "", val kind: String = "", val url: String? = null)
@Serializable data class Submission(
    val id: String = "",
    val status: String = "",
    val submitted: String? = null,
    val returned: String? = null,
    val resources: List<Resource> = emptyList(),
    val feedback: List<String> = emptyList(),
    val points: Double? = null,
)
@Serializable data class Assignment(
    val id: String,
    val classId: String,
    val className: String = "",
    val title: String = "",
    val due: String? = null,
    val closes: String? = null,
    val assigned: String? = null,
    val done: Boolean = false,
    val status: String = "",
    val points: Double? = null,
    val webUrl: String? = null,
    val canEdit: Boolean = false,
    val canUndo: Boolean = false,
    val lateAllowed: Boolean = false,
    val instructions: String = "",
    val resources: List<Resource> = emptyList(),
    val submission: Submission? = null,
)

// ---- mail ---------------------------------------------------------------------------------

@Serializable data class MailAddress(val name: String = "", val address: String = "")
@Serializable data class MailFile(val id: String = "", val name: String = "", val size: Long? = null, val type: String = "", val url: String = "")
@Serializable data class Mail(
    val id: String,
    val subject: String = "",
    val from: MailAddress = MailAddress(),
    val to: List<MailAddress> = emptyList(),
    val cc: List<MailAddress> = emptyList(),
    val time: String = "",
    val read: Boolean = true,
    val preview: String = "",
    val attachments: Boolean = false,
    val flagged: Boolean = false,
    val html: String = "",
    val files: List<MailFile> = emptyList(),
)
@Serializable data class MailPage(val messages: List<Mail> = emptyList(), val cursor: String? = null)
@Serializable data class Count(val count: Int = 0)

// ---- absences -----------------------------------------------------------------------------

@Serializable data class AbsenceSync(
    val configured: Boolean = false,
    val lastSync: String? = null,
    val lastError: String? = null,
    val blocked: Boolean = false,
    val stale: Boolean = false,
)
@Serializable data class AbsenceEntry(
    val id: Long,
    val date: String = "",
    val start: Int = 0,
    val end: Int = 0,
    val excused: Boolean = false,
    val status: String? = null,
    val untisReason: String = "",
    val late: Boolean = false,
    val lateMinutes: Int = 0,
    val units: List<String> = emptyList(),
)
@Serializable data class AbsenceDay(
    val date: String,
    val status: String = "open",
    val reason: String = "",
    val exportedAt: String? = null,
    val absences: List<AbsenceEntry> = emptyList(),
)
@Serializable data class Absences(val sync: AbsenceSync = AbsenceSync(), val name: String = "", val klasse: String = "", val days: List<AbsenceDay> = emptyList())
@Serializable data class SubjectStats(
    val subject: String = "",
    val subjectLong: String = "",
    val held: Int = 0,
    val excused: Int = 0,
    val unexcused: Int = 0,
    val present: Int = 0,
    val percent: Double? = null,
)
@Serializable data class AttendanceRange(val key: String = "", val start: String = "", val end: String = "", val label: String = "", val current: String = "s1")
@Serializable data class SubjectGroup(val name: String, val subjects: List<String> = emptyList())
@Serializable data class Attendance(
    val range: AttendanceRange? = null,
    val total: SubjectStats? = null,
    val subjects: List<SubjectStats> = emptyList(),
    val groups: List<SubjectGroup> = emptyList(),
    val allSubjects: List<String> = emptyList(),
)
@Serializable data class UntisLogin(val configured: Boolean = false, val server: String = "", val school: String = "", val user: String = "", val place: String = "")

// ---- moodle -------------------------------------------------------------------------------

@Serializable data class MoodleFile(val name: String = "", val url: String = "", val view: String = "", val mime: String = "", val size: Long = 0, val modified: String? = null)
@Serializable data class MoodleDue(
    val cmid: Long? = null,
    val name: String = "",
    val course: String = "",
    val courseId: Long? = null,
    val type: String = "",
    val due: String? = null,
    val overdue: Boolean = false,
    val action: String? = null,
    val url: String = "",
)
@Serializable data class MoodleCourse(
    val id: Long,
    val name: String = "",
    val short: String = "",
    val progress: Double? = null,
    val lastAccess: String? = null,
    val ended: Boolean = false,
    val favourite: Boolean = false,
    val grade: String? = null,
)
@Serializable data class MoodleHome(val due: List<MoodleDue> = emptyList(), val courses: List<MoodleCourse> = emptyList())
@Serializable data class MoodleDate(val id: String = "", val label: String = "", val time: String? = null)
@Serializable data class MoodleModule(
    val cmid: Long,
    val name: String = "",
    val type: String = "",
    val instance: Long? = null,
    val url: String = "",
    val description: String = "",
    val files: List<MoodleFile> = emptyList(),
    val link: String? = null,
    val done: Boolean = false,
    val restricted: String? = null,
    val dates: List<MoodleDate> = emptyList(),
)
@Serializable data class MoodleSection(val id: Long = 0, val number: Int = 0, val name: String = "", val summary: String = "", val modules: List<MoodleModule> = emptyList())
@Serializable data class MoodleCourseContent(val id: Long = 0, val name: String = "", val sections: List<MoodleSection> = emptyList())
@Serializable data class MoodleGrade(
    val name: String = "",
    val type: String = "",
    val total: Boolean = false,
    val cmid: Long? = null,
    val grade: String = "",
    val range: String = "",
    val percentage: String = "",
    val weight: String = "",
    val feedback: String = "",
    val gradedAt: String? = null,
)
@Serializable data class MoodleSubmission(
    val status: String = "none",
    val grading: String = "",
    val modified: String? = null,
    val canEdit: Boolean = false,
    val needsSubmit: Boolean = false,
    val locked: Boolean = false,
    val files: List<MoodleFile> = emptyList(),
    val text: String = "",
)
@Serializable data class MoodleFeedback(val grade: String = "", val gradedAt: String? = null, val comments: String = "", val files: List<MoodleFile> = emptyList())
@Serializable data class MoodleAssignment(
    val id: Long = 0,
    val cmid: Long = 0,
    val courseId: Long = 0,
    val course: String = "",
    val name: String = "",
    val url: String = "",
    val opens: String? = null,
    val due: String? = null,
    val cutoff: String? = null,
    val extensionDue: String? = null,
    val description: String = "",
    val attachments: List<MoodleFile> = emptyList(),
    val files: Boolean = false,
    val maxFiles: Int? = null,
    val maxBytes: Long? = null,
    val fileTypes: String = "",
    val onlineText: Boolean = false,
    val submitButton: Boolean = false,
    val team: Boolean = false,
    val submission: MoodleSubmission? = null,
    val feedback: MoodleFeedback? = null,
)
@Serializable data class MoodleLogin(val configured: Boolean = false, val url: String = "", val user: String = "", val blocked: Boolean = false)
@Serializable data class MoodleUpload(val id: String = "", val size: Long = 0)
@Serializable data class HtmlBody(val html: String = "")
