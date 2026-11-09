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

_FOOT = """<p class="note"><a href="privacy">Privacy</a> · <a href="terms">Terms</a></p>
</body>
</html>
"""

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
<ol>
<li><a href="{escape(connector_link(public_url))}">Add the custom connector in Claude</a>.
Keep the name exactly <strong>{escape(CONNECTOR_NAME)}</strong>. The research tools only work under that name.</li>
<li>{step2}</li>
<li>Install the plugin once from Claude's Plugins page. It follows your Claude account.
<span class="note">Placeholder: where the plugin comes from has not been decided yet.</span></li>
</ol>
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
    email: str,
    familysearch_id: str | None,
    account_id: str,
    deletion_code: str,
    projects: list[dict[str, Any]],
    openrouter_linked: bool | None,
) -> str:
    """The signed-in ``/``. ``openrouter_linked`` None means linking is off, and the page
    shows no OpenRouter section at all."""
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
            items.append(f'<li>{name} — <a href="api/projects/{pid}/download">Download</a></li>')
        project_list = "<ul>\n" + "\n".join(items) + "\n</ul>"
    else:
        project_list = '<p class="note">No projects yet. Start one from Claude.</p>'
    return (
        _HEAD.format(title="Genealogy Research beta")
        + f"""<h1>You're signed in</h1>
<p>{who}</p>
<p><strong>Go back to Claude and say "continue".</strong></p>
<p class="note">Not set up yet? Sign out to see the setup steps.</p>
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


def refused_page(message: str, *, temporary: bool = False) -> str:
    """``/`` for a session the tier refuses: the reason in plain text, never the account
    data. ``message`` is escaped whole, so no caller can put markup in it.

    ``temporary`` (the allowlist has not loaded yet) offers no Sign out: signing out
    revokes every one of the user's sessions, a poor trade for a wait of seconds."""
    if temporary:
        return (_HEAD.format(title="Genealogy Research beta")
                + f"<h1>The beta isn't ready yet</h1>\n<p>{escape(message)}</p>\n" + _FOOT)
    return (
        _HEAD.format(title="Genealogy Research beta")
        + f"""<h1>You can't use the beta with this account</h1>
<p>{escape(message)}</p>
<p><button type="button" onclick="postAndReload('auth/logout')">Sign out</button></p>
{_POST_AND_RELOAD}"""
        + _FOOT
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
