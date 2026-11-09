package com.galsever.school.ui

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.fromHtml
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.viewinterop.AndroidView
import com.galsever.school.net.ORIGIN
import com.galsever.school.ui.theme.Sc
import okhttp3.Request
import org.jsoup.Jsoup
import org.jsoup.nodes.Document
import org.jsoup.nodes.Element
import org.jsoup.safety.Cleaner
import org.jsoup.safety.Safelist
import java.io.ByteArrayInputStream

/**
 * Untrusted HTML from Teams, Outlook and Moodle. Chat messages become AnnotatedStrings (text, links, bold, lists) with
 * their images shown separately; mail and long rich text go into a locked WebView (no JavaScript, no file access,
 * remote loads blocked unless allowed, the hub's own URLs fetched with the gate cookie).
 */
object Html {
    private val chatList: Safelist = Safelist.basic().addTags("img", "h1", "h2", "h3", "h4", "table", "tr", "td", "th", "tbody", "thead", "hr")
        .addAttributes("img", "src", "alt")
        .addProtocols("img", "src", "https", "data")

    private val richList: Safelist = Safelist.relaxed()
        .addTags("hr", "center", "font", "s", "del", "ins", "figure", "figcaption", "caption")
        .addAttributes("img", "src", "alt", "width", "height")
        .addAttributes("td", "colspan", "rowspan")
        .addAttributes("th", "colspan", "rowspan")
        .addProtocols("img", "src", "https", "http", "data")
        .addAttributes(":all", "data-quote")
        .preserveRelativeLinks(true)

    /** Teams media hosts need the skype token: the hub proxies them (/api/media). */
    private val mediaHost = Regex("^https://[^/]+\\.(asyncgw\\.teams\\.microsoft\\.com|asm\\.skype\\.com)/")

    fun mediaUrl(src: String): String = if (mediaHost.containsMatchIn(src)) "$ORIGIN/api/media?url=" + Uri.encode(src) else absoluteSrc(src)

    private fun absoluteSrc(src: String) = if (src.startsWith("/")) ORIGIN + src else src

    data class Chat(val text: AnnotatedString, val images: List<String>)

    /** A chat message: text with links, and its pasted images (as loadable URLs). */
    fun chat(html: String): Chat {
        val doc = Cleaner(chatList).clean(Jsoup.parseBodyFragment(html, ORIGIN))
        val images = doc.select("img[src]").map { mediaUrl(it.attr("src")) }.distinct()
        doc.select("img").remove()
        // block elements and line breaks keep their line ends in fromHtml; trim the edges
        val body = doc.body().html().trim()
        val text = AnnotatedString.fromHtml(
            body,
            linkStyles = TextLinkStyles(SpanStyle(color = Sc.primary, textDecoration = TextDecoration.Underline)),
        )
        return Chat(text.trimEnd(), images)
    }

    private fun AnnotatedString.trimEnd(): AnnotatedString {
        var end = length
        while (end > 0 && this[end - 1].isWhitespace()) end--
        return subSequence(0, end)
    }

    /** Plain text with all tags and entities gone (previews). */
    fun text(html: String): String = Jsoup.parse(html).text()

    // ---- mail and rich text -------------------------------------------------------------------

    private val hidden = Regex("(^|;)\\s*(display\\s*:\\s*none|visibility\\s*:\\s*hidden|mso-hide\\s*:\\s*all|opacity\\s*:\\s*0|max-height\\s*:\\s*0(px)?)\\s*(!important)?\\s*(;|$)", RegexOption.IGNORE_CASE)
    private val quoteId = Regex("^(x_)*(divRplyFwdMsg|mail-editor-reference-message-container|OLK_SRC_BODY_SECTION)$")
    private val quoteClass = Regex("(^|\\s)(x_)*(gmail_quote|gmail_quote_container|moz-cite-prefix|yahoo_quoted|protonmail_quote)(\\s|$)")
    private val quoteStyle = Regex("border-top\\s*:\\s*solid\\s+#(e1e1e1|b5c4df)", RegexOption.IGNORE_CASE)

    data class Rich(val main: String, val quoted: String?, val blocked: Int)

    /**
     * Like the website's mailHtml: hidden parts and colors go, remote images only with [images], and with [collapse]
     * the quoted older mails are split off (they start at the first Outlook / Gmail / Apple quote marker).
     */
    fun rich(html: String, images: Boolean = true, collapse: Boolean = false): Rich {
        val raw = Jsoup.parse(html, ORIGIN)
        // before cleaning: ids, classes and styles are still there
        raw.select("[style]").filter { hidden.containsMatchIn(it.attr("style")) }.forEach { it.remove() }
        var quoteStart: Element? = null
        if (collapse) {
            quoteStart = raw.body().select("*").firstOrNull {
                quoteId.matches(it.id()) || quoteClass.containsMatchIn(it.className()) || quoteStyle.containsMatchIn(it.attr("style")) ||
                    (it.tagName() == "blockquote" && it.attr("type") == "cite")
            }
            quoteStart?.attr("data-quote", "1")
        }
        val clean: Document = Cleaner(richList).clean(raw)
        var blocked = 0
        clean.select("img").forEach { img ->
            val src = img.attr("src")
            when {
                src.startsWith("data:") || src.startsWith("/api/") || src.startsWith(ORIGIN) -> img.attr("src", absoluteSrc(src))
                mediaHost.containsMatchIn(src) -> img.attr("src", mediaUrl(src))
                images && src.startsWith("http") -> {}
                else -> { if (src.startsWith("http")) blocked++; img.remove() }
            }
        }
        clean.select("a[href]").forEach { it.attr("href", it.absUrl("href").ifEmpty { it.attr("href") }) }
        var quoted: String? = null
        val marker = clean.selectFirst("[data-quote]")
        if (marker != null) {
            // the marker and everything after it (also the following siblings of its parents) is the quote
            val tail = StringBuilder()
            var node: Element = marker
            while (node != clean.body()) {
                val parent = node.parent() ?: break
                val after = node.nextElementSiblings().toList()
                if (node == marker) {
                    tail.append(node.outerHtml())
                    node.remove()
                }
                after.forEach { tail.append(it.outerHtml()); it.remove() }
                node = parent
            }
            quoted = tail.toString().takeIf { Jsoup.parse(it).text().isNotBlank() }
            // a mail that is nothing but a quote stays open
            if (clean.body().text().isBlank()) { clean.body().append(tail.toString()); quoted = null }
        }
        clean.select("[data-quote]").removeAttr("data-quote")
        return Rich(clean.body().html(), quoted, blocked)
    }

    /** Dark page around cleaned HTML; colors and fonts of the sender are ignored on purpose. */
    fun page(body: String): String = """
        <!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
        :root { color-scheme: dark; }
        html, body { margin: 0; padding: 0; background: transparent; color: #F5F5F5; font: 15px/1.5 sans-serif; overflow-wrap: anywhere; }
        * { color: inherit !important; background: transparent !important; font-family: inherit !important; max-width: 100% !important; }
        a { color: #A684FF !important; }
        img { height: auto !important; border-radius: 6px; }
        table { border-collapse: collapse; width: auto !important; }
        td, th { border: 1px solid rgba(255,255,255,0.09); padding: 4px 6px; }
        blockquote { border-left: 3px solid rgba(255,255,255,0.15); margin: 0 0 0 4px; padding-left: 10px; color: #97979E !important; }
        pre, code { font-family: monospace !important; white-space: pre-wrap; background: #1F1F22 !important; border-radius: 4px; }
        p { margin: 0 0 8px; }
        </style></head><body>$body</body></html>
    """.trimIndent()
}

/**
 * Cleaned HTML in a WebView sized to its content: JavaScript off, no file or content access, links open outside,
 * the hub's URLs (inline images, /api/media) are fetched with the gate cookie, other remote loads only when [remote].
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun HtmlView(body: String, modifier: Modifier = Modifier, remote: Boolean = true) {
    val page = remember(body) { Html.page(body) }
    AndroidView(
        modifier = modifier.fillMaxWidth(),
        factory = { ctx ->
            WebView(ctx).apply {
                layoutParams = android.view.ViewGroup.LayoutParams(android.view.ViewGroup.LayoutParams.MATCH_PARENT, android.view.ViewGroup.LayoutParams.WRAP_CONTENT)
                setBackgroundColor(0)
                settings.javaScriptEnabled = false
                settings.allowFileAccess = false
                settings.allowContentAccess = false
                settings.blockNetworkLoads = false
                settings.loadsImagesAutomatically = true
                isVerticalScrollBarEnabled = false
                webViewClient = object : WebViewClient() {
                    // the height is the content's: measure again once the page (and its images) are laid out
                    override fun onPageFinished(view: WebView, url: String?) = view.requestLayout()

                    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                        val url = request.url.toString()
                        runCatching { ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }
                        return true
                    }

                    override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                        val url = request.url.toString()
                        if (url.startsWith(ORIGIN)) {
                            return runCatching {
                                val res = app.http.newCall(Request.Builder().url(url).build()).execute()
                                val type = res.header("Content-Type")?.substringBefore(";") ?: "application/octet-stream"
                                WebResourceResponse(type, null, res.body!!.byteStream())
                            }.getOrNull() ?: empty()
                        }
                        if (url.startsWith("data:") || (remote && url.startsWith("https://"))) return null
                        return empty()
                    }

                    private fun empty() = WebResourceResponse("text/plain", null, ByteArrayInputStream(ByteArray(0)))
                }
            }
        },
        update = { view ->
            if (view.tag != page) {
                view.tag = page
                view.loadDataWithBaseURL(ORIGIN + "/", page, "text/html", "utf-8", null)
            }
        },
    )
}
