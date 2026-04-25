# OAuth Login Testing Guide

This guide walks you through testing the `login`, `logout`, and
`auth_status` tools after they're built. Follow each layer in order.
Don't skip ahead — each layer catches different problems.

## What OAuth is (30 seconds)

"OAuth" is how one app lets you log in using another app — the same way
you click **Sign in with Google** on a random website. In our case, the
tool opens FamilySearch's login page in your browser. You sign in as
yourself. FamilySearch then hands our tool a secret "token" that lets
the tool act on your behalf later — without ever seeing your password.

Three files are involved:

- `~/.familysearch-mcp/config.json` — stores your FamilySearch "app
  key" (called a **client ID**) so you don't have to type it every
  time.
- `~/.familysearch-mcp/tokens.json` — stores the login token after you
  sign in, so you stay logged in between runs.
- Both files are saved with permission `600` (only you can read them).

## Before You Start

### 1. Make sure the server builds

```bash
cd ~/cowork-genealogy/mcp-server
npm run build
npm test
```

All 57 tests should pass. If anything is red, fix it first — manual
testing on a broken build just wastes time.

### 2. Get a FamilySearch developer account

You need:

- A FamilySearch developer app registered at
  https://www.familysearch.org/developers/
- The app's **client ID** (also called "app key"). For this project
  the dev key is stored separately — ask the project owner if you
  don't have it.
- The redirect URI `http://127.0.0.1:1837/callback` registered on your
  FS app. It must match **exactly** — one wrong character and FS will
  reject the login.
- (Optional but recommended) Email `devsupport@familysearch.org` and
  ask them to enable the `offline_access` scope so the tool can
  refresh your login without making you sign in every 24 hours.

### 3. Make sure port 1837 is free

Our tool starts a tiny local web server on port 1837 to catch the
redirect from FamilySearch. If something else is already using that
port, login will fail.

Check:

```bash
lsof -i :1837 || echo "port 1837 is free"
```

If you see output showing another process, stop it or choose a
different port (which means changing the spec + redirect URI — don't
do this casually).

---

## How to Find Your Machine Paths

Several steps below need paths specific to your machine. Find them
once now and substitute throughout the rest of the guide.

### In WSL2 (your Linux terminal)

```bash
echo $HOME            # your WSL2 home, e.g. /home/yourname
whoami                # your WSL2 username
which node            # full path to node, e.g.
                      # /home/yourname/.nvm/versions/node/v20.20.2/bin/node
```

### In PowerShell (Windows)

```powershell
wsl.exe -l            # lists installed distros, e.g. "Ubuntu"
echo $env:USERNAME    # your Windows username
echo $HOME            # your Windows home, e.g. C:\Users\yourname
```

### Conventions used in this guide

- `~/cowork-genealogy` — the project location in WSL2. Substitute if
  yours is elsewhere.
- `<your-wsl-user>` — replace with output of `whoami` (WSL2).
- `<your-windows-user>` — replace with `$env:USERNAME` (PowerShell).
- `<distro>` — replace with the name from `wsl.exe -l`.
- `<node-version>` — replace with whatever version `which node`
  prints (e.g. `v20.20.2`).

---

## Layer 1: MCP Inspector

**What this tests:** Do the three tools show up? Do they behave
correctly at each stage — no config, dummy config, real config?

**Time needed:** 20 minutes

### Start the Inspector

1. Open a terminal in WSL2.

2. Run:

   ```bash
   cd ~/cowork-genealogy/mcp-server
   npx @modelcontextprotocol/inspector node build/index.js
   ```

3. A browser window opens showing MCP Inspector.

4. Look at the tools list on the left. You should see **five** tools:
   - `wikipedia_search`
   - `places`
   - `login`
   - `logout`
   - `auth_status`

   If any of the three new ones (`login`, `logout`, `auth_status`) are
   missing, check that `src/index.ts` imports and register them.

### Part A — No config yet (error messages)

First, make sure you have no leftover config from a previous run:

```bash
rm -rf ~/.familysearch-mcp
```

Now in the Inspector:

1. Click **`auth_status`** → **Call Tool**. No arguments needed.

   Expected response:
   ```json
   { "loggedIn": false }
   ```

2. Click **`logout`** → **Call Tool**. No arguments needed.

   Expected response:
   ```json
   { "success": true, "message": "Logged out of FamilySearch. Stored tokens have been cleared." }
   ```

   This should succeed even though you were never logged in — it's
   safe to call `logout` any time.

3. Click **`login`** → **Call Tool** with **no arguments**.

   Expected response: a failure with a message that tells you exactly
   what to do:
   ```
   FamilySearch client ID is not configured. Create the file
   ~/.familysearch-mcp/config.json with shape
   { "clientId": "<your-FamilySearch-dev-key>" }
   or pass `clientId` to the login tool to have it written automatically.
   ```

   If you see this, the error handling is working. Move on.

### Part B — Dummy client ID (test the browser launch)

Here we prove that the browser opens and the local server is listening
on port 1837, **without needing a real FS key yet**.

1. In the Inspector, call **`login`** with this argument:

   ```json
   { "clientId": "test-dummy" }
   ```

2. What you should see:
   - Your default browser opens a FamilySearch login page.
   - FamilySearch shows an **error** saying the client is invalid —
     **this is the success signal for this layer**. It proves the URL
     was built correctly and the browser launched.
   - Close the browser tab.
   - Back in the Inspector, the login call will eventually return a
     failure (or you can wait up to 5 minutes for it to time out).

3. Check that the config file was written correctly:

   ```bash
   ls -la ~/.familysearch-mcp/
   cat ~/.familysearch-mcp/config.json
   stat -c '%a %n' ~/.familysearch-mcp/config.json
   ```

   You should see:
   - `config.json` exists.
   - It contains `{"clientId":"test-dummy"}`.
   - Permissions are `600` (only you can read/write).

### Part C — Real dev key (full end-to-end)

Wipe the dummy config so we start from a clean first-time flow:

```bash
rm -rf ~/.familysearch-mcp
```

Restart the Inspector (stop with Ctrl+C, then re-run the command from
step 1).

1. Call **`login`** with your **real** FamilySearch client ID:

   ```json
   { "clientId": "YOUR-FAMILYSEARCH-DEV-KEY" }
   ```

   (Replace `YOUR-FAMILYSEARCH-DEV-KEY` with the actual key.)

2. Follow the flow:
   - Browser opens the real FamilySearch login page.
   - Sign in with your FamilySearch account.
   - FamilySearch redirects you to `http://127.0.0.1:1837/callback…`.
   - Our page shows "Login successful — you can close this tab".
   - Back in the Inspector, the `login` call returns:
     ```json
     { "success": true, "message": "Login successful." }
     ```

3. Verify the session exists:

   ```json
   auth_status()   // no arguments
   ```

   Expected response:
   ```json
   {
     "loggedIn": true,
     "expiresAt": "2026-04-25T…Z",
     "expiresInMinutes": 1440,
     "hasRefreshToken": true
   }
   ```

   - `expiresInMinutes` is roughly 1440 (24 hours).
   - `hasRefreshToken` will be `false` if FamilySearch hasn't enabled
     `offline_access` for your app yet. That's OK — login still
     works, you just have to sign in again each day.

4. Check that tokens were saved:

   ```bash
   ls -la ~/.familysearch-mcp/
   stat -c '%a %n' ~/.familysearch-mcp/tokens.json
   ```

   Expected:
   - `tokens.json` exists.
   - Permissions are `600`.
   - (Don't `cat` this file casually — it contains your real login
     token. Treat it like a password.)

5. Log out:

   ```json
   logout()
   ```

   Expected: success, and `~/.familysearch-mcp/tokens.json` is gone.

6. Confirm the session is cleared:

   ```json
   auth_status()   // → { "loggedIn": false }
   ```

7. Log back in **without passing the clientId** — the tool should
   remember it from the config file:

   ```json
   login()
   ```

   Expected: same flow as step 2, but you never had to re-type the key.

### What success looks like (Layer 1)

- All three tools show up in the Inspector.
- `login` with no config gives a clear, helpful error.
- `login` with a dummy key opens a browser.
- `login` with the real key completes the whole round-trip, writes
  `tokens.json`, and `auth_status` shows `loggedIn: true`.
- `logout` wipes the session.
- Re-running `login()` with no args uses the stored clientId.

### What failure looks like

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Tools missing from Inspector | `src/index.ts` doesn't import or register the tool | Check imports + the two handler arrays |
| `EADDRINUSE` error on login | Port 1837 already in use (maybe a previous stuck login) | `lsof -i :1837`, stop the offender, retry |
| Browser doesn't open | Running in a headless env; or no default browser set | The error message will give you the URL — open it manually |
| FS shows error page even with real key | Redirect URI not registered in your FS app config | Confirm `http://127.0.0.1:1837/callback` is registered *exactly* |
| `state mismatch` error | Two browser tabs were racing, or you reused an old URL | Close extra tabs, call `login` again |
| `hasRefreshToken: false` | FS hasn't enabled `offline_access` on your app | Email `devsupport@familysearch.org` |

### When to move on

Move to Layer 2 when Part C works end-to-end: you can log in, see
`loggedIn: true`, log out, and log in again with no args.

---

## Layer 2: Claude Code as Client

**What this tests:** Does Claude understand *when* to call `login` and
*how* to pass the clientId?

**Time needed:** 10 minutes

### Steps

1. Open a NEW terminal window.

2. Create a test folder:

   ```bash
   mkdir -p ~/mcp-test-scratch
   cd ~/mcp-test-scratch
   ```

3. Register the server with Claude Code:

   ```bash
   claude mcp add --transport stdio genealogy-dev -- node /home/<your-wsl-user>/cowork-genealogy/mcp-server/build/index.js
   ```

4. Start Claude Code:

   ```bash
   claude
   ```

5. Wipe any stored config first so you test the first-time setup path:

   ```bash
   rm -rf ~/.familysearch-mcp
   ```

6. Ask Claude to log you in — give it the key in natural English:

   > "Use genealogy-dev to log me in to FamilySearch. My client ID is
   > YOUR-FAMILYSEARCH-DEV-KEY."

7. Watch for:
   - Claude picks the `login` tool (not `wikipedia_search` or
     anything else).
   - Claude passes `clientId` correctly (check the tool-call panel).
   - Your browser opens to FamilySearch.
   - After you sign in, Claude reports success.

8. Test status + logout in conversation:

   > "What's my FamilySearch auth status?"
   > "Now log me out of FamilySearch."
   > "Check my status again."

   Claude should call `auth_status`, `logout`, and `auth_status`
   respectively and report each result.

### What success looks like

Claude uses the right tool at the right time, passes the right
arguments, and explains the results in plain language.

### What failure looks like

- Claude asks you for the key again after you already logged in → the
  tool's description isn't clear about stored config. Tweak the
  description in `src/tools/login.ts`.
- Claude calls `login` instead of `auth_status` when you ask for
  status → `auth_status`'s description is too weak.
- Claude calls `wikipedia_search` when you ask to log in → something
  is seriously wrong with the `login` tool's description.

### Troubleshooting

If you change the server code:

1. Rebuild: `cd ~/cowork-genealogy/mcp-server && npm run build`
2. In Claude Code, type `/mcp` to reconnect.
3. Try your request again.

### When to move on

Move to Layer 3a when Claude correctly drives all three tools from
natural-language prompts.

---

## Choose Your Layer 3 Order

Layers 1 and 2 are platform-agnostic — everyone runs them. Layer 3
splits by where Cowork's MCP server runs, and **both sub-layers are
required**: the server has to work in WSL2 (where many devs run it)
and on native Windows (where end users install it). The only thing
that changes based on your dev environment is the order:

| Your dev environment | Run first | Then |
|----------------------|-----------|------|
| WSL2 | Layer 3a (WSL2) | Layer 3b (Native Windows) |
| Native Windows | Layer 3b (Native Windows) | Layer 3a (WSL2) |

Test your dev environment first — bugs there are faster to diagnose.
The second pass catches cross-environment issues the first pass
can't see.

---

## Layer 3a: Cowork via WSL2

**What this tests:** Does the full pipeline work in Cowork, talking
through the WSL2 bridge?

**Time needed:** 15 minutes

**Prerequisite:** Claude Desktop must be installed on Windows.

### How this works

Your code lives in WSL2 (Linux). Claude Desktop runs on Windows. The
config tells Claude Desktop to use `wsl.exe` to reach into WSL2 and
run your server.

```
Claude Desktop (Windows) → wsl.exe → Your server (WSL2) → FamilySearch
```

The browser step still happens on **Windows**, because that's where
Claude Desktop (and your default browser) live. So when our server
opens the auth URL, it opens in your Windows browser.

One catch: the server binds `127.0.0.1:1837` **inside WSL2**.
Windows-side Chrome/Edge can still reach it because WSL2 forwards
`127.0.0.1` between the two. If this doesn't work on your machine,
see the troubleshooting note below.

### Steps

1. Find Claude Desktop's config file on the WINDOWS side:

   Open Claude Desktop → **Settings → Developer → Edit Config**.

2. Get the full path to Node in WSL2:

   ```bash
   which node
   ```

   You'll see something like
   `/home/<your-wsl-user>/.nvm/versions/node/<node-version>/bin/node`.

   **WARNING:** Node 22 has networking bugs in WSL2 that break `fetch`.
   Use Node 20:

   ```bash
   nvm install 20
   nvm use 20
   which node
   ```

3. Add your server to the config (keep any existing `mcpServers`
   entries):

   ```json
   {
     "mcpServers": {
       "genealogy-dev": {
         "command": "wsl.exe",
         "args": [
           "-d", "<distro>",
           "--cd", "/home/<your-wsl-user>/cowork-genealogy/mcp-server",
           "--",
           "/home/<your-wsl-user>/.nvm/versions/node/<node-version>/bin/node",
           "build/index.js"
         ]
       }
     }
   }
   ```

   Use the path you got in step 2. If your distro isn't called
   "Ubuntu", check with `wsl.exe -l` in PowerShell and replace it.

4. FULLY restart Claude Desktop:
   - Find the Claude icon in the Windows system tray (bottom-right).
   - Right-click → **Quit**.
   - Reopen Claude Desktop from the Start menu.

5. Open a Cowork session pointed at any folder.

6. Wipe any stored config so you test the first-time setup path:

   ```bash
   rm -rf ~/.familysearch-mcp
   ```

7. Test in chat:

   > "Log me in to FamilySearch. My client ID is YOUR-FAMILYSEARCH-DEV-KEY."

   Follow the browser flow. Then ask:

   > "What's my auth status?"

### What success looks like

Claude calls `login`, your browser opens, you complete the FS login,
Claude reports success, and `auth_status` shows `loggedIn: true`.

### What failure looks like

- Claude doesn't see any genealogy tool → config typo or Claude
  Desktop wasn't fully restarted.
- Server-side error `ETIMEDOUT` or `fetch failed` → you're on Node 22;
  switch to Node 20.
- Browser opens to the FS URL, you sign in, but the redirect page
  hangs forever → Windows-side `127.0.0.1` isn't reaching WSL2's port
  1837. Try running the MCP server on the Windows side (Layer 3b
  catches this case anyway).

### Viewing logs

If something fails, check server logs:

1. Claude Desktop → **Settings → Developer → View Logs**.
2. Look for entries tagged with `[genealogy-dev]`.

### When to move on

Move to Layer 3b once the WSL2 bridge handles a full login + status +
logout round-trip.

---

## Layer 3b: Cowork via Native Windows

**What this tests:** Does the full pipeline work in Cowork running
on native Windows — no WSL2 in the picture?

**Time needed:** 20–30 minutes (includes installing Node.js on
Windows if you don't have it).

**Why this matters:** Most users don't use WSL2. Their Claude Desktop
will run the server directly on Windows. That uncovers bugs WSL2
hides:

- Path separator issues (`/` vs `\`)
- File permission differences (mode `0o600` behaves differently)
- Home directory path differences (`C:\Users\you` vs `/home/you`)

### Prerequisites

Install Node.js on Windows (not WSL2):

1. Open PowerShell (not WSL2).
2. Check: `node --version`.
3. If not installed, get it from https://nodejs.org/ and install.

### Steps

1. Open PowerShell.

2. Copy the project from WSL2 to a native Windows location. The
   Windows side of the WSL bridge can't handle the symlinks in
   `node_modules`, so we copy the source (excluding build outputs)
   and rebuild on Windows.

   ```powershell
   # Substitute <distro>, <your-wsl-user>, <your-windows-user>
   robocopy \\wsl$\<distro>\home\<your-wsl-user>\cowork-genealogy `
            C:\Users\<your-windows-user>\cowork-genealogy `
            /E /XD node_modules build releases .git
   ```

   What each flag does:
   - `/E` — copy all subdirectories
   - `/XD node_modules build releases .git` — skip these dirs.
     `node_modules` is the source of the symlink breakage; `build`
     and `releases` will be regenerated; `.git` is excluded so we
     don't drag history (drop it from the exclusion if you want git
     history on the Windows copy too).

   You can pick any destination — `C:\dev\cowork-genealogy`,
   `$HOME\code\cowork-genealogy`, etc. — just be consistent in step
   4 below.

3. Install and build from PowerShell, **in the Windows copy**:

   ```powershell
   cd C:\Users\<your-windows-user>\cowork-genealogy\mcp-server
   npm install
   npm run build
   ```

   Watch for errors here — this is where cross-platform bugs appear.

   **PowerShell execution-policy gotcha:** if `npm install` errors
   with "running scripts is disabled on this system," run this once
   and retry:

   ```powershell
   Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
   ```

   This is Microsoft's recommended developer default. It allows
   locally-created scripts (like `npm.ps1`) to run while still
   requiring internet-downloaded scripts to be signed. Affects only
   your user; no admin needed.

4. Update Claude Desktop config for native Windows:

   ```json
   {
     "mcpServers": {
       "genealogy-native": {
         "command": "node",
         "args": ["C:\\Users\\<your-windows-user>\\cowork-genealogy\\mcp-server\\build\\index.js"]
       }
     }
   }
   ```

   Use double backslashes or forward slashes. If pointing at WSL2
   files instead:
   ```
   "\\\\wsl$\\<distro>\\home\\<your-wsl-user>\\cowork-genealogy\\mcp-server\\build\\index.js"
   ```

   **If you already have a `genealogy-dev` (WSL2) entry,** comment it
   out or remove it for this test. Tools from both servers expose
   the same names (`login`, `places`, etc.) and Claude can't reliably
   choose between them, which muddies the Layer 3b signal. After
   3b passes, you can re-add it for daily dev.

5. FULLY restart Claude Desktop.

6. On Windows, the config and tokens files live at
   `C:\Users\<you>\.familysearch-mcp\`. Wipe any existing:

   ```powershell
   Remove-Item -Recurse -Force $HOME\.familysearch-mcp -ErrorAction SilentlyContinue
   ```

7. Open Cowork and test:

   > "Log me in to FamilySearch. My client ID is YOUR-FAMILYSEARCH-DEV-KEY."

   Browser opens on Windows → sign in → success.

8. Verify the files on Windows:

   ```powershell
   ls $HOME\.familysearch-mcp\
   ```

   You should see `config.json` (and `tokens.json` after a successful
   login).

### What success looks like

Same as Layer 3a — full login round-trip works — but now it's running
natively on Windows with no WSL2 in the path.

### What failure looks like

- `npm install` or `npm run build` errors → cross-platform code
  issues. Check for hardcoded Linux paths or shell syntax.
- File permissions error on saving `config.json`/`tokens.json` →
  Windows handles `mode: 0o600` differently but `fs.writeFile` should
  still succeed. If it doesn't, file an issue.
- Browser opens but FamilySearch redirects to `localhost:1837` instead
  of `127.0.0.1:1837` → the dev-console registration is wrong. Only
  `http://127.0.0.1:1837/callback` will work with this server.

### Cross-platform gotcha table

| Problem | Fix |
|---------|-----|
| Hardcoded `/` in paths | Use `path.join()` |
| Hardcoded `~` for home | Use `os.homedir()` |
| Using `npx` in config | Use `npx.cmd` on Windows |
| Shell pipelines in code | Avoid — use Node APIs instead |

### You're done when

Login, status, and logout all work in Cowork on **native Windows**,
and the config + tokens files show up in
`C:\Users\<you>\.familysearch-mcp\`.

---

## Extra: Manually testing the refresh path

The refresh path (where an expired token gets renewed behind the
scenes) isn't directly callable from the MCP tools yet — it only
kicks in when an **authenticated** tool like `collections` calls
`getValidToken()`. The unit tests cover it thoroughly, so you can
skip this until authenticated tools are built. If you want to force
it manually:

1. Log in successfully so `tokens.json` exists.
2. Edit the `expiresAt` field to a past timestamp:

   ```bash
   python3 - <<'PY'
   import json, pathlib
   p = pathlib.Path.home() / ".familysearch-mcp" / "tokens.json"
   d = json.loads(p.read_text())
   d["expiresAt"] = 0
   p.write_text(json.dumps(d))
   PY
   ```

3. Run a one-shot call to `getValidToken`:

   ```bash
   cd ~/cowork-genealogy/mcp-server
   npx tsx -e 'import("./src/auth/refresh.js").then(m => m.getValidToken().then(t => console.log("got:", t.slice(0,8)+"…"), e => console.error("err:", e.message)))'
   ```

4. Check `tokens.json` — `expiresAt` should now be in the future
   again, and you got back a valid access token.

This only works if `hasRefreshToken` was `true` when you logged in.
If you don't have `offline_access` yet, the refresh call will throw
with a clear "re-authenticate" message instead.

---

## Quick Reference: Commands

| What | Command |
|------|---------|
| Build server | `cd mcp-server && npm run build` |
| Run tests | `cd mcp-server && npm test` |
| Run Inspector | `npx @modelcontextprotocol/inspector node build/index.js` |
| Check port 1837 | `lsof -i :1837` |
| Wipe stored config + tokens | `rm -rf ~/.familysearch-mcp` |
| Inspect config | `cat ~/.familysearch-mcp/config.json` |
| Check file perms | `stat -c '%a %n' ~/.familysearch-mcp/*` |
| Reconnect in Claude Code | `/mcp` |
| Claude Desktop config | Settings → Developer → Edit Config |
| Claude Desktop logs | Settings → Developer → View Logs |

---

## Summary: What Each Layer Catches

| Layer | What it tests | Bugs it catches |
|-------|---------------|-----------------|
| 1 - Inspector (no creds) | Tool registration + error UX | Missing tools, unhelpful error messages |
| 1 - Inspector (dummy key) | Browser launch + local server | Port conflicts, browser-open failure |
| 1 - Inspector (real key) | Full OAuth round-trip | URL building, state check, token save |
| 2 - Claude Code | LLM understands the tools | Bad tool descriptions, confusing params |
| 3a - Cowork WSL2 | Full path through WSL2 | WSL2 bridge + port forwarding |
| 3b - Cowork Native | Full path on native Windows | Windows path + permission issues |

**Don't skip layers.** Each one catches bugs the others miss.
