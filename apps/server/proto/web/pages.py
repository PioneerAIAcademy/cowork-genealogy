"""The chat-off tier's own pages (#4001): ``/`` signed out (onboarding) and signed in
(account, projects and OpenRouter).

A top-level module on purpose, like ``policies.py``: the Beanstalk web bundle copies only
the top-level ``*.py`` files of ``proto/web/`` (``scripts/eb_bundles/build.py``), so an
``.html`` file or a ``pages/`` folder would pass on compose and 404 there. No absolute
links: the edge strips a path prefix (``auth.base_path()``), and ``/`` is served with its
trailing slash, so a relative ``api/...`` resolves under the prefix.

Every interpolated value goes through ``html.escape``. A project label comes from the
agent-written ``research.json``, so an unescaped label would be stored XSS on the page
that holds the deletion code.

Lines that begin "Placeholder" wait on a decision that is not ours to make here: where
research runs (the plan's Surface decision), what signing in again looks like (the live
sittings, issue #3529), where the plugin zip comes from, and the feedback address.
"""

from __future__ import annotations

from html import escape
from typing import Any, Literal
from urllib.parse import quote, urlsplit

CONNECTOR_NAME = "Genealogy Research"
OPENROUTER_KEYS_URL = "https://openrouter.ai/settings/keys"

_HEAD = """<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<style>
body {{ font-family: system-ui, sans-serif; max-width: 42rem; margin: 2rem auto; padding: 0 1rem; line-height: 1.5; }}
code {{ background: #f2f2f2; padding: 0 .25rem; }}
.note {{ color: #555; }}
</style>
</head>
<body>
"""

def _foot(up: str = "") -> str:
    """The footer. ``up`` is the relative step back to the tier's root: "" on ``/``,
    "../" on ``/upload/<id>``, so the links keep the prefix the edge strips."""
    return f"""<p class="note"><a href="{up}privacy">Privacy</a> · <a href="{up}terms">Terms</a></p>
</body>
</html>
"""


_FOOT = _foot()

# POST from a page, then reload: a <form> would land the browser on the route's JSON.
# Relative URLs, so the prefix the edge strips stays on.
_POST_AND_RELOAD = """<script>
async function postAndReload(path, body) {
  const r = await fetch(path, {method: "POST", credentials: "same-origin",
    headers: body ? {"Content-Type": "application/json"} : {}, body: body ? JSON.stringify(body) : undefined});
  if (!r.ok) { alert("That did not work (" + r.status + "). Reload the page and try again."); return; }
  location.reload();
}
</script>
"""


def connector_link(public_url: str) -> str:
    """claude.ai's prefilled add-connector link for the tool server's ``/mcp``. The edge
    serves ``/mcp`` at the host root (plan § Architecture; malachi ``nginx.conf``
    ``location = /mcp``), so only PUBLIC_URL's scheme and host are kept, never a path prefix.
    The name must stay "Genealogy Research": the agents list their tools under that name."""
    parts = urlsplit(public_url)
    mcp = f"{parts.scheme}://{parts.netloc}/mcp"
    return (
        "https://claude.ai/customize/connectors?modal=add-custom-connector"
        f"&connectorName={quote(CONNECTOR_NAME)}&connectorUrl={quote(mcp, safe='')}"
    )


def _setup_steps(public_url: str, step2: str) -> str:
    """The three setup steps, on both pages. ``step2`` is the sign-in step's HTML."""
    return f"""<ol>
<li><a href="{escape(connector_link(public_url))}">Add the custom connector in Claude</a>.
Keep the name exactly <strong>{escape(CONNECTOR_NAME)}</strong>. The research tools only work under that name.</li>
<li>{step2}</li>
<li>Install the plugin once from Claude's Plugins page. It follows your Claude account.
<span class="note">Placeholder: where the plugin comes from has not been decided yet.</span></li>
</ol>"""


def _setup_steps(public_url: str, step2: str) -> str:
    """The three setup steps, on both pages. ``step2`` is the sign-in step's HTML."""
    return f"""<ol>
<li><a href="{escape(connector_link(public_url))}">Add the custom connector in Claude</a>.
Keep the name exactly <strong>{escape(CONNECTOR_NAME)}</strong>. The research tools only work under that name.</li>
<li>{step2}</li>
<li>Install the plugin once from Claude's Plugins page. It follows your Claude account.
<span class="note">Placeholder: where the plugin comes from has not been decided yet.</span></li>
</ol>"""


def signed_out_page(*, public_url: str, sign_in: Literal["familysearch", "dev"] | None) -> str:
    """Onboarding, the plan's D4. ``sign_in`` picks the step-2 control: FamilySearch when it
    is configured, the dev-login button locally, or neither (a line saying sign-in is off)."""
    if sign_in == "familysearch":
        step2 = '<a href="auth/familysearch/login">Sign in with FamilySearch</a>.'
    elif sign_in == "dev":
        step2 = ('<button type="button" onclick="postAndReload(\'auth/dev-login\', {})">Sign in (local dev)</button>'
                 + _POST_AND_RELOAD)
    else:
        step2 = "Sign in. (Sign-in is not configured on this server.)"
    return (
        _HEAD.format(title="Genealogy Research beta")
        + f"""<h1>Genealogy Research beta</h1>
<h2>Get started</h2>
{_setup_steps(public_url, step2)}
<h2>Before you start</h2>
<ul>
<li><strong>Where research runs.</strong> Placeholder: this waits on the Surface decision.</li>
<li><strong>A paid Claude plan.</strong> Plugins need one.</li>
<li><strong>Living people.</strong> Do not store information about living people.</li>
<li><strong>This is a beta.</strong> Nothing promises your work survives, so download what you want to keep.</li>
<li><strong>No desktop extension.</strong> Turn the Genealogy Research desktop extension off on that Claude account,
under Settings → Extensions on each computer, or use a second Claude account.</li>
<li><strong>Signing in again.</strong> Placeholder: what to expect when FamilySearch ends a session, and when the
connector itself needs reconnecting (Settings → Connectors), will be written from the live sittings.</li>
<li><strong>Feedback.</strong> Email it with the conversation pasted in, because this server does not store your
conversations. Placeholder: the feedback address has not been supplied yet.</li>
<li><strong>Team and Enterprise plans.</strong> An Owner adds the connector and makes the plugin available.</li>
</ul>
"""
        + _FOOT
    )


def signed_in_page(
    *,
    public_url: str,
    email: str,
    familysearch_id: str | None,
    account_id: str,
    deletion_code: str,
    projects: list[dict[str, Any]],
    openrouter_linked: bool | None,
    uploads: bool = False,
) -> str:
    """The signed-in ``/``. ``openrouter_linked`` None means linking is off, and the page
    shows no OpenRouter section at all. ``uploads`` (UPLOADS_ENABLED) adds each project's
    Upload link; off, the page links nothing the upload route would refuse. The setup steps
    stay on the page: once sign-out also ends the connector's tokens, "sign out to see them"
    would undo step 1."""
    # A user with no FamilySearch id (dev-login) is not shown as a FamilySearch account.
    who = (f"Signed in with the FamilySearch account {escape(email)} "
           f"(FamilySearch id <code>{escape(familysearch_id)}</code>)." if familysearch_id
           else f"Signed in as {escape(email)}.")
    if projects:
        items = []
        for p in projects:
            pid = escape(str(p["id"]))
            label = p.get("label")
            name = escape(label) if isinstance(label, str) and label else "<em>Untitled project</em>"
            upload = f'<a href="upload/{pid}">Upload a file</a> · ' if uploads else ""
            items.append(f'<li>{name} — {upload}<a href="api/projects/{pid}/download">Download</a></li>')
        project_list = "<ul>\n" + "\n".join(items) + "\n</ul>"
    else:
        project_list = '<p class="note">No projects yet. Start one from Claude.</p>'
    return (
        _HEAD.format(title="Genealogy Research beta")
        + f"""<h1>You're signed in</h1>
<p>{who}</p>
<p><strong>Go back to Claude and say "continue".</strong></p>
<details><summary>Setup steps</summary>
{_setup_steps(public_url, "Sign in. You have done this.")}</details>
<h2>Your projects</h2>
{project_list}
{_openrouter_section(openrouter_linked)}<h2>Your account</h2>
<p>Account id: <code>{escape(account_id)}</code><br>
Deletion code: <code>{escape(deletion_code)}</code></p>
<p class="note">To have your account and projects deleted, email the feedback address with both.
Placeholder: the feedback address has not been supplied yet. Keep the deletion code private.</p>
<p><button type="button" onclick="postAndReload('auth/logout')">Sign out</button></p>
{_POST_AND_RELOAD}"""
        + _FOOT
    )


def refused_page(message: str, *, temporary: bool = False, up: str = "") -> str:
    """A page for a session the tier refuses: the reason in plain text, never the account
    data. ``message`` is escaped whole, so no caller can put markup in it. ``up`` as for
    ``_foot``: "../" when served from ``/upload/<id>``, so Sign out and the footer resolve.

    ``temporary`` (the allowlist has not loaded yet) offers no Sign out: signing out
    revokes every one of the user's sessions, a poor trade for a wait of seconds."""
    if temporary:
        return (_HEAD.format(title="Genealogy Research beta")
                + f"<h1>The beta isn't ready yet</h1>\n<p>{escape(message)}</p>\n" + _foot(up))
    return (
        _HEAD.format(title="Genealogy Research beta")
        + f"""<h1>You can't use the beta with this account</h1>
<p>{escape(message)}</p>
<p><button type="button" onclick="postAndReload('{up}auth/logout')">Sign out</button></p>
{_POST_AND_RELOAD}"""
        + _foot(up)
    )


def not_found_page() -> str:
    """``/upload/<id>`` for a project that is missing or someone else's: one page for both,
    so the answer does not confirm the id exists."""
    return (_HEAD.format(title="Not found")
            + '<h1>Project not found</h1>\n<p><a href="../">Back to your projects</a></p>\n' + _foot("../"))


# The upload page's script. pdf.js reads the text layer in the browser; the file and its
# text go to POST /api/projects/{id}/files in one request, with an upload progress bar.
# Every message is set with textContent, never innerHTML.
_UPLOAD_SCRIPT = r"""<script type="module">
const form = document.getElementById("upload");
const input = document.getElementById("file");
const button = document.getElementById("send");
const bar = document.getElementById("progress");
const status = document.getElementById("status");
const project = form.dataset.project;

function say(text, error) {
  status.textContent = text;
  status.className = error ? "error" : "";
}

// --- text layer: start (tests/test_pdfjs_vendored.py runs this block under Node) ---
// The vendored version (static/pdfjs/README.md), in both URLs, so after an upgrade a
// cached old file is never paired with a new one: pdf.js refuses a mismatched worker.
const PDFJS_VERSION = "6.4.299";
const PDFJS_DIR = new URL("../static/pdfjs/", location.href);
let pdfjsLib = null;

// Loaded on the first PDF only, so a pdf.js that fails to load never blocks an image.
async function loadPdfjs() {
  if (pdfjsLib === null) {
    const lib = await import(new URL(`pdf.min.mjs?v=${PDFJS_VERSION}`, PDFJS_DIR).href);
    lib.GlobalWorkerOptions.workerSrc = new URL(`pdf.worker.min.mjs?v=${PDFJS_VERSION}`, PDFJS_DIR).href;
    pdfjsLib = lib;
  }
  return pdfjsLib;
}

// One line per pdf.js line (item.hasEOL), so a register's rows stay rows: name, age and
// place keep to the line they share in the record.
function pageText(items) {
  return items
    .map((item) => item.str + (item.hasEOL ? "\n" : " "))
    .join("")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line)
    .join("\n");
}

// The text layer, one block per page under a "--- Page N ---" marker, or "" when the PDF
// has none (a scan). A file that is not a PDF has no text layer to read. Throws when
// pdf.js cannot read the file; the caller decides what to tell the patron.
async function textLayer(file) {
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  if (!isPdf) return "";
  const lib = await loadPdfjs();
  // pdf.js 6 cleans up through the loading task: the document has no destroy().
  const task = lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), verbosity: 0 });
  try {
    const doc = await task.promise;
    const pages = [];
    for (let n = 1; n <= doc.numPages; n++) {
      say(`Reading the PDF's text: page ${n} of ${doc.numPages}…`);
      pages.push(pageText((await (await doc.getPage(n)).getTextContent()).items));
    }
    if (!pages.some((page) => page)) return "";
    return pages.map((page, i) => `--- Page ${i + 1} ---\n${page}`).join("\n\n");
  } finally {
    await task.destroy();
  }
}
// --- text layer: end ---

// UPLOAD_MAX_BYTES in project_blobs.py: refused here before the file is read or sent.
const MAX_BYTES = 26214400;

function send(file, text) {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `../api/projects/${project}/files`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        bar.value = Math.round((e.loaded / e.total) * 100);
        say(`Uploading… ${bar.value}%`);
      }
    };
    xhr.onload = () => resolve(xhr);
    xhr.onerror = () => resolve(null);
    const body = new FormData();
    body.append("file", file);
    if (text) body.append("text", text);
    xhr.send(body);
  });
}

// The upload route's refusals (POST /api/projects/{id}/files), in the patron's words.
const TOO_BIG = "The file is too large. A file and its text together must be under 25 MB.";
const REFUSED = {
  401: "Your sign-in has ended. Reload this page to sign in again.",
  403: "This account can no longer use the beta. Reload this page to see why.",
  404: "This project was not found, or uploads are turned off.",
  413: TOO_BIG,
  415: "TIFF and HEIC images are not accepted. Save the page as JPEG or PNG and upload that.",
  422: "This PDF has more than one page and no text in it, so it looks like a scan. Upload its pages one at a time, as separate files.",
  503: "Uploads are not available right now. Try again later.",
};
// A 422 after pdf.js could not read the file is not a scan: say what happened instead.
const UNREADABLE = "This PDF's text could not be read here (it may be password-protected or damaged), and a PDF of several pages needs its text. Save it again as a PDF without a password, or upload its pages one at a time.";

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const file = input.files[0];
  if (!file) { say("Choose a file first.", true); return; }
  if (file.size > MAX_BYTES) { say(TOO_BIG, true); return; }
  button.disabled = true;
  let text = "";
  let unreadable = false;
  try {
    text = await textLayer(file);
  } catch (err) {
    // Sent with no text layer, and the route decides. Logged, so it is not silent.
    console.error("Reading the PDF's text failed:", err);
    unreadable = true;
  }
  bar.value = 0;
  bar.hidden = false;
  say("Uploading…");
  const xhr = await send(file, text);
  bar.hidden = true;
  button.disabled = false;
  if (xhr === null) { say("The upload did not reach the server. Check your connection and try again.", true); return; }
  let body = {};
  try { body = JSON.parse(xhr.responseText); } catch (err) { body = {}; }
  if (xhr.status === 200) {
    say(`Uploaded ${body.path}` + (body.textPath ? ", with its text layer."
      : unreadable ? ". Its text could not be read here, so no text layer was saved." : ". No text layer was found in it."));
    form.reset();
  } else if (xhr.status === 429) {
    const wait = xhr.getResponseHeader("Retry-After");
    say(`Other uploads are in progress. Try again${wait ? ` in ${wait} seconds` : " shortly"}.`, true);
  } else if (xhr.status === 422 && unreadable) {
    say(UNREADABLE, true);
  } else if (REFUSED[xhr.status]) {
    say(REFUSED[xhr.status], true);
  } else {
    say(`The upload failed (${xhr.status}${body.detail ? `: ${body.detail}` : ""}).`, true);
  }
});
</script>
"""


def upload_page(*, project_id: str, label: str | None) -> str:
    """``/upload/<id>`` for the project's owner: choose a file, pdf.js reads a PDF's text
    layer in the browser, and both go to the upload route with a progress bar. Served at
    ``/upload/<id>`` (no trailing slash), so every link and import steps up with "../"."""
    name = escape(label) if isinstance(label, str) and label else "<em>Untitled project</em>"
    return (
        _HEAD.format(title="Upload a file")
        .replace("</style>", "progress { width: 100%; }\n.error { color: #b00020; }\n</style>")
        + f"""<h1>Upload a file</h1>
<p>To the project {name}.</p>
<p class="note">A PDF's text is read here in your browser and saved beside the file, so the research agent can
read it. A PDF of several pages with no text (a scan) is refused: upload its pages one at a time.
JPEG and PNG images are accepted; TIFF and HEIC are not.</p>
<form id="upload" data-project="{escape(project_id)}">
<p><input type="file" id="file" name="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"></p>
<p><button type="submit" id="send">Upload</button></p>
<progress id="progress" max="100" value="0" hidden></progress>
<p id="status" role="status" aria-live="polite"></p>
</form>
<p><a href="../">Back to your projects</a></p>
{_UPLOAD_SCRIPT}"""
        + _foot("../")
    )


def _openrouter_section(linked: bool | None) -> str:
    if linked is None:
        return ""
    keys = f'<a href="{OPENROUTER_KEYS_URL}">OpenRouter\'s key settings</a>'
    if linked:
        body = f"""<p>Your OpenRouter account is linked.</p>
<p><strong>The linked key has no spending limit.</strong> Set one in {keys}.</p>
<p><button type="button" onclick="postAndReload('openrouter/unlink')">Unlink</button>
<span class="note">Unlinking forgets the key here only. Delete it in {keys} when you are done.</span></p>"""
    else:
        body = f"""<p><a href="openrouter/link">Link your OpenRouter account</a>.</p>
<p class="note">OpenRouter creates the key with no spending limit. After linking, set one in {keys},
and delete the key there when you are done.</p>"""
    return f"<h2>OpenRouter</h2>\n{body}\n"
