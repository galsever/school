package com.galsever.school.ui

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import android.webkit.MimeTypeMap
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.ActivityResult
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.FileProvider
import com.galsever.school.net.ApiException
import com.google.mlkit.vision.documentscanner.GmsDocumentScanner
import com.google.mlkit.vision.documentscanner.GmsDocumentScannerOptions
import com.google.mlkit.vision.documentscanner.GmsDocumentScanning
import com.google.mlkit.vision.documentscanner.GmsDocumentScanningResult
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter

/** Files the app downloads or makes live in cache/files (shared through the FileProvider), one folder per action. */
object Files {
    fun dir(ctx: Context): File = File(ctx.cacheDir, "files").apply { mkdirs() }

    private fun safe(name: String) = name.replace(Regex("[\\\\/:*?\"<>|\\x00-\\x1f]"), "_").take(120).ifBlank { "file" }

    fun newFile(ctx: Context, name: String): File =
        File(File(dir(ctx), System.nanoTime().toString()).apply { mkdirs() }, safe(name))

    fun uri(ctx: Context, file: File): Uri = FileProvider.getUriForFile(ctx, ctx.packageName + ".files", file)

    fun mimeOf(name: String, fallback: String = "application/octet-stream"): String =
        MimeTypeMap.getSingleton().getMimeTypeFromExtension(name.substringAfterLast('.', "").lowercase()) ?: fallback

    /** Opens a file of the device in the app that handles its type, else offers to share it. */
    fun open(ctx: Context, file: File, mime: String) {
        val uri = uri(ctx, file)
        val view = Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        try {
            ctx.startActivity(view)
        } catch (e: ActivityNotFoundException) {
            share(ctx, file, mime)
        }
    }

    fun share(ctx: Context, file: File, mime: String) {
        val send = Intent(Intent.ACTION_SEND).setType(mime)
            .putExtra(Intent.EXTRA_STREAM, uri(ctx, file))
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        ctx.startActivity(Intent.createChooser(send, file.name))
    }

    fun openUrl(ctx: Context, url: String) {
        runCatching { ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }
    }

    /** A picked document copied into the cache, with its display name. */
    suspend fun copyIn(ctx: Context, uri: Uri): File = withContext(Dispatchers.IO) {
        val name = ctx.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
            if (c.moveToFirst()) c.getString(0) else null
        } ?: "file"
        val out = newFile(ctx, name)
        ctx.contentResolver.openInputStream(uri)!!.use { input -> out.outputStream().use { input.copyTo(it) } }
        out
    }

    fun scanName(): String = "Scan " + LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH.mm")) + ".pdf"
}

/** Downloads a hub file (path or URL) and opens it on the device; a snackbar shows while it loads. */
fun CoroutineScope.openRemote(ctx: Context, snack: SnackbarHostState, path: String, name: String) = launch {
    val note = launch { snack.showSnackbar("Opening $name", duration = SnackbarDuration.Indefinite) }
    try {
        val target = Files.newFile(ctx, name)
        val (serverName, type) = app.api.download(path, target)
        // Office files arrive converted to PDF under another name
        val file = if (serverName != null && serverName != target.name) {
            File(target.parentFile, serverName.replace("/", "_")).also { target.renameTo(it) }
        } else target
        val mime = if (type == "application/octet-stream") Files.mimeOf(file.name) else type
        note.cancel()
        Files.open(ctx, file, mime)
    } catch (e: ApiException) {
        note.cancel()
        if (e.code != "gate_login") snack.showSnackbar(e.message)
    }
}

/** Picks one or more documents of the device; they arrive copied into the cache. */
@Composable
fun rememberFilePicker(onPicked: (List<File>) -> Unit): () -> Unit {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        if (uris.isNotEmpty()) scope.launch { onPicked(uris.map { Files.copyIn(ctx, it) }) }
    }
    return { launcher.launch(arrayOf("*/*")) }
}

/**
 * Camera pages -> one PDF: the Play services document scanner finds the page edges, straightens and crops them,
 * and lets the user add, reorder and retake pages before it hands back the PDF.
 */
@Composable
fun rememberScanner(snack: SnackbarHostState, onPdf: (File) -> Unit): () -> Unit {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) { r: ActivityResult ->
        if (r.resultCode != Activity.RESULT_OK) return@rememberLauncherForActivityResult
        val pdf = GmsDocumentScanningResult.fromActivityResultIntent(r.data)?.pdf?.uri ?: return@rememberLauncherForActivityResult
        scope.launch {
            val out = withContext(Dispatchers.IO) {
                val f = Files.newFile(ctx, Files.scanName())
                ctx.contentResolver.openInputStream(pdf)!!.use { input -> f.outputStream().use { input.copyTo(it) } }
                f
            }
            onPdf(out)
        }
    }
    val scanner: GmsDocumentScanner = GmsDocumentScanning.getClient(
        GmsDocumentScannerOptions.Builder()
            .setGalleryImportAllowed(true)
            .setPageLimit(40)
            .setResultFormats(GmsDocumentScannerOptions.RESULT_FORMAT_PDF)
            .setScannerMode(GmsDocumentScannerOptions.SCANNER_MODE_FULL)
            .build(),
    )
    return {
        val activity = ctx as Activity
        scanner.getStartScanIntent(activity)
            .addOnSuccessListener { launcher.launch(IntentSenderRequest.Builder(it).build()) }
            .addOnFailureListener { e -> scope.launch { snack.showSnackbar(e.message ?: "Scanner not available") } }
    }
}
