# Mail

The Mail tab is the school Outlook mailbox through Graph, with the same sign-in as Teams (no extra consent). Server: `server/school/mail.py`. Website: `web/src/routes/mail.tsx`, body handling in `web/src/lib/format.ts` (`mailHtml`), styles `.tm-msg` / `.tm-mail` in `web/src/index.css`.

## What the user sees

- **List**: Inbox, Sent, Archive, search (keeps the list on screen while it loads, X clears), unread dot, paperclip, date (time today, `dd.mm.` this year, `dd.mm.yy` older). 50 per page, more on scroll.
- **Unread badge** on the Mail icon = unread count of the inbox (`/api/mail/unread`, every minute).
- **Conversation like a chat**: opening a mail shows its whole conversation (`/api/mail/{id}/thread`: every folder, so own replies from Sent are in it), oldest first, opened at the bottom. Own mails are on the right in the accent color, others on the left with their avatar, a day divider where the day changes. A click on a mail's header shows all addresses. Opening marks every unread mail of the conversation read; the list dots and the badge update without a refetch.
- **Earlier mails collapse**: in a reply only the new text shows; a `···` button below it opens the quoted older mails. Forwards (subject `Fwd:`, `WG:`, `TR:`) stay open because the quote is the content, and so does a mail that is nothing but a quote.
- **Own look, darkened**: every mail keeps the sender's styles, fonts, colors and layout and is shown darkened (see MailFrame below). The sun button per mail shows the original colors on white.
- **Images**: remote images are not loaded until "Show images" is clicked (a remote image tells the sender that and from where the mail was opened). Attachments and inline images of the mail itself always show. Image attachments get a thumbnail, every file its size.
- **Writing**: the bar at the bottom: Reply, Reply all (only when it reaches more people), Forward; keys `r`, `a`, `f`. The editor opens inline below the last mail of the conversation with To and Cc filled in (editable). A reply to an own mail goes to its recipients, like Outlook. Bold, italic, underline, lists, links (Ctrl+B/I/U work too), attachments by button, drop or paste (25 MB together). Ctrl+Enter sends, Esc or the bin discards (asks when something is written). **New mail** uses the same editor with a subject. Leaving a written mail asks "Discard this mail?". Everything goes through `/api/mail/compose` (API.md).

## How a mail is rendered (MailFrame)

`mailHtml(html, {images, collapse, styled: true})` keeps `style`, `class` and the color and font attributes and returns the sender's `<style>` blocks as `css` (without `@import`). That HTML is only ever put into `MailFrame` in `mail.tsx`, never into the page:

- `<iframe srcdoc sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox">`: no `allow-scripts`, so nothing in it runs (DOMPurify removes scripts and handlers anyway). `allow-same-origin` is only there so the page can measure the height; links open in a new tab (`<base target="_blank">`).
- A CSP meta in the frame: `default-src 'none'`, images only from our own routes and `data:` (plus `https:` after "Show images"), no remote fonts or CSS. Remote images in `style` or `background` are blocked by it too.
- Dark: `body { filter: invert(1) hue-rotate(180deg) }` and the same filter again on `img`, `picture`, `video` and elements with a background image, so pictures look normal. Light backgrounds get dark, black text light, colors keep their hue. Outlook and Gmail do the same for HTML mail.
- The iframe element and its document both have `color-scheme: light` (the page is dark; a mismatch would paint the frame white). Height follows the body with a ResizeObserver (late images, narrower pane); content wider than the pane scrolls sideways inside the frame.

## How a mail body is made safe and readable (`mailHtml`)

Mail HTML is untrusted. `mailHtml(html, {images, collapse})` runs it through DOMPurify once and returns `{main, quoted, blocked, css}`:

1. **Sanitize** like chat messages (`safeHtml`; with `styled`, steps 1 and 2 keep `style`, `class` and the color and font attributes): no `style`, `class`, `id`, forms, iframes, scripts. Mail also drops SVG, MathML, video, audio and `srcset`.
2. **Colors and fonts go**: `color`, `bgcolor`, `background`, `face`, `size` and the body link colors are removed. Outlook writes `<font color="#000000">`, which was black on the dark theme.
3. **Hidden parts go**: an element whose inline style hides it (`display:none`, `visibility:hidden`, `mso-hide:all`, `opacity:0`, `max-height:0`) is removed. Because all styles are stripped, newsletter preheaders would show otherwise.
4. **Images**: `src` must be an attachment route of the app or a `data:` URL. Remote images are removed and counted in `blocked` unless `images` is true. Leftover `cid:` images are removed.
5. **Quote split**: the first element that starts the quoted older mails gets marked; everything from there to the end goes into `quoted`, empty lines at the end of `main` are trimmed.

Quote start markers (checked in the `uponSanitizeElement` hook, because ids, classes and styles are gone afterwards):

| Client | Marker |
|---|---|
| Outlook web and mobile | `id="divRplyFwdMsg"` (the `<hr>` right before it belongs to the quote). Graph prefixes ids of nested quotes with `x_` |
| Apple Mail, iOS Mail | `<blockquote type="cite">` |
| Outlook desktop | `<div style="border-top:solid #E1E1E1 ...">` around the From/Sent header |
| Gmail, Thunderbird, Yahoo, Proton | classes `gmail_quote`, `moz-cite-prefix`, `yahoo_quoted`, `protonmail_quote` |

A new mail client that is not collapsed: add its marker to `QUOTE_ID`, `QUOTE_CLASS` or `QUOTE_STYLE` in `format.ts`.

**Tables and links** (`.tm-mail`): most mail tables are layout, so only a table with a `border` attribute gets cell borders. Tables and images are capped to the pane width, the body scrolls sideways inside its own box if something is still wider. Links break only where a word would overflow.

## S/MIME signed mails

Signed mails (the ZID ticket system) come from Graph with the body, but their inline images and attachments are packed into one attachment `smime.p7m` with content type `multipart/signed`. That is plain MIME: `mail.signed_parts` parses it with Python's `email` module (cached 10 minutes), `get_mail` rewrites `cid:` images and lists the real files, and `/api/mail/{id}/attachments/{aid}/parts/{n}` serves them. The signature is not verified or shown. Encrypted mails are not handled.

## Search

`q` goes to Graph as `$search="..."`, one phrase. A `"` or backslash inside is a Graph syntax error, so both are replaced by spaces. `$search` cannot be combined with `$orderby`, so results come in Graph's relevance order.

## Testing without a browser

There is no headless browser on the dev box. Both of these only read:

```
# server, against the real mailbox (dev token in data/). Never name the script inspect.py.
cd server && PYTHONPATH=. DATA_DIR=../data APP_AUTH=none ../.venv/bin/python script.py
#   from school import mail;  await mail.get_mail(id, mark_read=False)
#   from fastapi.testclient import TestClient; from school.main import app   (routes; GET /api/mail/{id} marks read)

# mailHtml on saved mail HTML: bundle format.ts and run it under jsdom (jsdom@24 on Node 20)
npx esbuild web/src/lib/format.ts --bundle --format=esm --outfile=/tmp/format.mjs
#   in the test: globalThis.window = new JSDOM('').window before `await import('/tmp/format.mjs')`
```

In the live site, check with Claude in Chrome and open only mails that are already read.

## Not done

- Empty gaps inside quoted Outlook replies.
- No Unread filter chip, no delete, archive, move or flag, no drafts (an unsent text is lost when the page is closed).
- The list stays one row per mail (conversations are only grouped when a mail is opened).
- `send_mail` and `reply_mail` of the MCP still send plain text.
- The inbox badge counts every unread mail (about 1460 in November 2026, so it shows 99+).
