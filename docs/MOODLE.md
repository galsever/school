# Moodle

The Moodle tab is the school Moodle (moodle.spengergasse.at) inside the hub: courses with their files, assignments with hand-in, grades, choices and publications. The `moodle_*` MCP tools are the former `moodle-mcp` (Go, stdio, galsever/moodle-mcp), rewritten into the hub on 2026-11-10.

| Part | File |
|---|---|
| client: login, calls, cache, files, shapes, submissions, choices, publications | `server/school/moodle.py` |
| routes, uploads waiting for a submission, text of files, MCP tools | `server/school/moodle_api.py` |
| course list, course page, grades | `web/src/routes/moodle.tsx` |
| assignment panel | `web/src/routes/moodle-assignment.tsx` |
| choice and publication (open inside the course) | `web/src/routes/moodle-choice.tsx` |
| types, calls, queries, browser cache | `web/src/lib/moodle.ts` |
| Moodle card in Settings | `web/src/routes/settings.tsx` |
| tests (fake Moodle, no network) | `server/tests/test_moodle.py` |

## What the user sees

- **List** (left column): *Moodle* with the reload button, a search box, *Open* (what is still to do, from Moodle's timeline: due within 180 days or overdue for 30), then the courses with a code tile (`NSCS`) and the course grade when there is one. On a wide screen the course opened last in this browser opens by itself.
- **Search**: course names, activity names and file names of every course at once (all courses are read when the tab opens). A file hit opens the file, an activity hit scrolls to it in its course and marks it, an assignment hit opens the assignment.
- **Course**: header with the title, *Course* | *Grades* (the course total next to *Grades*) and *Open in Moodle*. *Course* shows the course's own *Open* list, then every section as a folding card in Moodle's own order with the teacher's text in full.
- **Rows by type**, with Moodle's colours (pink hand-in, blue material, amber choice, green links and forums):
  - file: opens inline in a new tab (PDF, images, text, media), the download icon on hover saves it;
  - folder: unfolds its files (open by itself up to 6 files);
  - page: unfolds its text;
  - assignment: opens the assignment panel; the right side shows the grade, else a check when handed in, else when it is due (amber soon, red late);
  - choice and publication: unfold in place (below);
  - restricted: lock icon, Moodle's reason as tooltip;
  - forums, quizzes, links and everything else: open in Moodle.
- **Grades**: every grade item of the course with grade, range and the teacher's feedback; an assignment item opens its panel.
- **Assignment panel** (right side, full screen on a phone; Back returns to the course): due date, status, grade, the task, material, *My work* and feedback.
  - *My work*: drop files on it or *Add file*, *X* removes one, an online text field with *Save text* where the assignment takes text.
  - Assignments with a submit button stay a draft until *Submit*, which asks *Really submit?* once (4 s).
  - Items with nothing to hand in (only a grade) show no status and no *My work*.
- **Choice**: the teacher's text, then Moodle's responses as columns: *Not answered*, then one column per option with count and limit (`2 / 2 Full`) and the names; the own pick is marked. While the choice is open a pick list comes first; *Save* sends the pick.
- **Publication** (student files folder, for example *Themenvorstellung_Informationen*):
  - *My files*: drop or *Add file*, *X* removes, a file with a taken name replaces the old one, a check shows Moodle's approval state (tooltip).
  - *Published*: everybody's files with who posted them, a filter from 9 files on, *Download all* (one zip).
  - Everything in a publication is visible to the whole course.
- **Reload** (round arrow): empties the server cache and reads everything on screen again. Without it, data is at most a minute old.
- **Settings, Moodle card**: user and password. Shows *Login rejected* in red when Moodle refused the stored login.

## Login

Stored in `/data/moodle.json` (0600): `{url, user, password}`. Saving the card does **one** login at Moodle and stores the login only if it worked; an empty password keeps the stored one. For development the server also takes `MOODLE_USERNAME` / `MOODLE_PASSWORD` from the environment when no file exists.

Two ways in, both with that login:

| | What | Used for |
|---|---|---|
| web service | `login/token.php`, service `moodle_mobile_app` (the Moodle app's API); the key it returns is kept in `/data/moodle-token.json` | everything with an API: courses, contents, timeline, grades, assignments, choices, files, uploads |
| website session | the normal login form, cookies in memory only | the publication plugin, which has no API |

**Never retry a rejected login** (the school locks accounts). A rejected password marks the login as blocked (hash in `moodle-token.json`); every call fails with `moodle_not_connected` until the login is changed in Settings. An expired key is replaced once by a fresh login. A website session that ran out is logged in again once.

## Speed

- Every read goes through a 60 s cache on the server; the same read running twice at the same time is sent once.
- The browser keeps the last list, courses and grades (localStorage, key prefix `moodle:2:`), so the tab paints at once and refreshes in the background.
- Opening the tab reads every course in parallel: switching courses takes a few milliseconds.
- Hovering an assignment row reads the assignment ahead.
- Measured on 2026-11-10: first load about 1 s, course switch 4 to 12 ms, a PDF about 20 ms, reload 0.8 s.

## Files

Moodle file addresses (`pluginfile.php`) only work with the key, so the browser never gets them: every file goes through `/api/moodle/file?url=`, which only fetches addresses on the Moodle host itself and adds the key there. Embedded images and links in teacher text are rewritten to that route (`local_html`). The httpx request log blanks the key (`_NoToken` filter): never log a file address yourself.

## Hand-in (assignments)

`mod_assign_save_submission` replaces the data of **every** enabled submission plugin. So `save_submission` sends the whole state each time: a fresh draft area, the files already there downloaded and uploaded again (minus the removed ones and the ones with a new file of the same name), the new files, and the current online text. The browser first uploads each file to `/api/moodle/uploads` (it waits an hour at most), then sends the upload ids. `submit_for_grading` accepts the submission statement.

## Choices

`mod_choice_get_choice_options` gives the options with the own pick and what is still free; a closed choice gives no options, only the reason, so the rows then come from `mod_choice_get_choice_results`, which also gives the names and the *Not answered* list when the teacher shows them. *Save* calls `mod_choice_submit_choice_response`.

## Publication

The plugin (`mod_publication`) has no web service functions, so the server uses the website session:

| Step | Request |
|---|---|
| list | `view.php?id=<cmid>&page=N` for every page (own files above, the table `publications` below) |
| one file | `view.php?id=<cmid>&download=<file id>` |
| all files | `view.php?id=<cmid>&action=zip` |
| open the edit form | POST `view.php` with the form's hidden fields and `gotoupload` -> `upload.php` with the draft area (`attachment_filemanager`), max files and max size |
| remove a file | POST `repository/draftfiles_ajax.php?action=delete` (`sesskey`, `itemid`, `filepath`, `filename`) |
| add a file | web service `upload.php` into the same draft area |
| save | POST `upload.php` with the form fields and `submitbutton` |

The limits from the form (6 files, 50 MB each on *Themenvorstellung_Informationen*) are checked before anything changes. A page that still shows the form after saving is an error; its message is passed on. Tested live by the user on 2026-11-10.

## MCP tools

| Tool | What |
|---|---|
| `moodle_deadlines` | open to-dos of the timeline (`days` ahead, overdue ones unless `skip_overdue`) |
| `moodle_courses` | enrolled courses; ended ones with `include_past` |
| `moodle_course_contents` | sections, activities and files of a course (`section` filters) |
| `moodle_assignment` | one assignment in full (`assignment_id` or `cmid`; a cmid passed as id is found too) |
| `moodle_grades` | course grades, or every item of one course |
| `moodle_read_file` | text of a file (PDF, Word, PowerPoint, OpenDocument, HTML, code), images as images, a signed `download_url` (15 min) |
| `moodle_upload_link` | step one of a hand-in: an upload id and a signed link; send the file with `curl -T <file> '<url>'` |
| `moodle_submit_assignment` | change the submission (upload ids, online text, `replace_files`), `finalize` submits for grading |

The hub cannot read the model's disk, hence the two steps for a hand-in. `moodle_upload_link` and `moodle_submit_assignment` are the only writing tools; choices and publications have no tools.

## Data

| File in `/data` | What |
|---|---|
| `moodle.json` | the login (0600) |
| `moodle-token.json` | the web service key, or the hash of a blocked login (0600) |
| `moodle-uploads/` | files on their way into a submission or publication, removed after an hour |

## Testing

- `cd server && ../.venv/bin/python -m pytest tests` runs against a fake Moodle (`httpx.MockTransport`) and fake publication pages: login once, renewal, never retrying a wrong password, cache, file address checks, hand-in keeping files, choices, publication pages and the upload form flow.
- Against the real Moodle only read: the account is real. Votes, hand-ins and publication uploads only on the user's word.
- A dev copy with the real data: uvicorn on the dev box's tailnet address (`--host DEV_TAILNET_IP --port 8791`, `APP_AUTH=none`, the login in the environment), opened in the user's Chrome at `http://dev-box:8791/moodle`. Stop it when done: it has no login of its own.
