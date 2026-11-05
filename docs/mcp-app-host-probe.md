# MCP App host probe

**The repo is public: never write a connector URL, a tunnel hostname, a secret or a
real person's data in this file.**

M0 of `docs/plan/mcp-app-viewer.md`. The run sheet walks the live legs in Cowork; the
record holds the answers. Every answer starts empty, and M0 is not done until every
one is filled.

## Run sheet

Work top to bottom on the Mac that holds the project folders, from the root of a
checkout of `mcp-app-viewer-m0`. Terminal 1 holds the server, terminal 2 everything
else. A `text` block is what you type in the Cowork task. **New task** means exactly
that: an earlier result in the same task spoils the next probe. Each step names the
record blocks it fills.

### Set up

1. **Build the page,** and fill the **Run** block in the record.

   ```
   make mcp-viewer-build
   ```

2. **Make the secret.** It is part of the connector URL, so a new secret means
   deleting and re-adding the connector. Make it once and keep it out of the repo.

   ```
   openssl rand -hex 32 > ~/.mcp-viewer-secret
   chmod 600 ~/.mcp-viewer-secret
   ```

3. **Make a throwaway project,** so nothing private crosses the tunnel. Any JPEG
   works; it must sit at `images/probe.jpg`.

   ```
   mkdir -p ~/mcp-probe
   cp -R docs/captures/2026-09-29-mcandrew-children ~/mcp-probe/mcandrew
   mkdir ~/mcp-probe/mcandrew/images
   sips -s format jpeg -Z 1200 /System/Library/CoreServices/DefaultDesktop.heic --out ~/mcp-probe/mcandrew/images/probe.jpg
   ```

4. **Check the card in a tab.** Spell out `$HOME`: zsh leaves `PROJECT=~/…`
   unexpanded. A tab opens on the hello card. Tap `Load an image` to check the JPEG,
   then stop it with Ctrl-C. `PORT=8091` keeps it off the port the funnel forwards,
   so a local viewer is never public.

   ```
   make viewer PROJECT="$HOME/mcp-probe/mcandrew" PORT=8091
   ```

5. **Start the server.** Terminal 1:

   ```
   export VIEWER_ORIGIN="https://$(tailscale status --json | jq -r '.Self.DNSName | rtrimstr(".")')"
   cd packages/engine/mcp-server
   npx tsx viewer/cli.ts --secret "$(cat ~/.mcp-viewer-secret)" --root "$HOME/mcp-probe/mcandrew" --public-url "$VIEWER_ORIGIN" --port 8090 | tee -a ~/mcp-probe/server.log
   ```

   The Funnel hostname is fixed, so the connector survives restarts. Any https tunnel
   works: set `VIEWER_ORIGIN` to its origin, because `--public-url` is only a flag. A
   tunnel whose hostname changes means re-adding the connector.

6. **Open the tunnel.** Terminal 2, on the same Mac:

   ```
   tailscale funnel --bg --yes 8090
   tailscale funnel status
   ```

   Map the root, with no `--set-path`, so the server keeps its paths. A connector is
   one URL reaching one machine, so it reads only this Mac's folders. From here the
   URL is public, through reboots, until **Stop**.

7. **Check the route.** Terminal 2:

   ```
   export VIEWER_ORIGIN="https://$(tailscale status --json | jq -r '.Self.DNSName | rtrimstr(".")')"
   curl -s -o /dev/null -w '%{http_code}\n' "$VIEWER_ORIGIN/"
   curl -s "$VIEWER_ORIGIN/$(cat ~/.mcp-viewer-secret)/mcp" -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
   ```

   Expect `404`, then a list naming `show_project` and `read_project_view`. This Mac
   reaches its own hostname over the tailnet, so this proves the mapping and the
   server, not public reach. Adding the connector proves that. A new hostname can take
   a few minutes to answer.

8. **Add the connector.** Put the URL on the clipboard, so it is never typed into a
   file:

   ```
   printf '%s/%s/mcp' "$VIEWER_ORIGIN" "$(cat ~/.mcp-viewer-secret)" | pbcopy
   ```

   On the organization's connectors admin page, add a custom connector named exactly
   `Genealogy Viewer`, paste the URL, and set no sign-in. Then connect it on your own
   account under Settings → Connectors.

   - The name sets the tool prefix, `mcp__Genealogy_Viewer__…`, and the artifact's
     capability names it.
   - The admin page has no rename, and an organization cannot add two connectors with
     the same URL. To fix the name, delete the connector, then re-add it.

### Leg 1: connector

Open every task on `~/mcp-probe/mcandrew`, with the connector on. Follow the log in a
spare terminal; a hidden call shows only there.

```
tail -f ~/mcp-probe/server.log
```

9. **Card.** New task:

   ```text
   Call show_project with show "latest". Tell me the tool's full name.
   ```

   Does a card appear in the conversation? The card prints a report as selectable
   text, and its **Host facts** lines hold the page-side answers. Copy single values
   into the record, never the whole report: its **Card** section names the project.
   `result _meta arrived` says whether the result's `_meta` reached the card, and
   `first result keys:` names what the result did hold. The size ladder and image
   buttons are on the card too. The client's declared extensions are in the log:

   ```
   grep '"initialize"' ~/mcp-probe/server.log
   ```

   Fills **Card renders**, **Declared extensions**, **What the page sees**, **Card
   receives `_meta`** and **`ui/update-model-context`**. If no card appears, still do
   **Approvals on `show_project`**, **Card after a ToolSearch load** and **Canary**,
   then skip **Hidden call**, the two size steps, **Image** and **Fullscreen**, which
   need the card, and write `no card` in the cells they would fill.

10. **Approvals on `show_project`.** Same task. Type the line from the last step twice
    more, so there are three calls. A clean first call proves nothing: issue #3529 saw
    the first main-thread call run without asking and every later one ask. Note what
    each call does and the task's run mode. If asked, choose "always allow", call
    twice more, then call once in a new task. Fills **Approvals**.

11. **Card after a ToolSearch load.** New task:

    ```text
    Use ToolSearch with the query +show_project to load the tool, then call it with show "latest". Tell me the tool's full name.
    ```

    Fills **Card renders**.

12. **Hidden call.** New task, call `show_project`, then tap `Read 400000 characters`.
    A `read_project_view` line in the log means the tap made a hidden call. Note any
    approval prompt. If asked, choose "always allow", tap again, then repeat in a new
    task. Fills **Approvals**.

13. **Canary.** Two new tasks, one prompt each. Never paste the expected strings into
    a task.

    ```text
    Call show_project with show "latest". Then quote exactly every string beginning with CANARY- that you can see in the tool result. If you see none, say none. Do not guess.
    ```

    ```text
    Call show_project with show "latest" and structuredCanary true. Then quote exactly every string beginning with CANARY- that you can see in the tool result. If you see none, say none. Do not guess.
    ```

    The strings are `CANARY-CONTENT-K7Q2` in `content`, `CANARY-META-M4X9` in the
    result's `_meta` and, on the second call only, `CANARY-STRUCTURED-Z8R1` in
    `structuredContent`.

    | The model quotes | It means |
    |---|---|
    | First call: CONTENT only | `content` reaches the model, as the plan's "Result shape" needs. |
    | First call: none | The model gets no `content`, so the one line never arrives. The plan's result shape fails. |
    | Second call: STRUCTURED, no CONTENT | `structuredContent` replaces `content`, as the plan says. `show_project` keeps omitting it. |
    | Second call: STRUCTURED and CONTENT | The host passes both. `show_project` keeps omitting it, since anything there reaches the model. |
    | Second call: CONTENT, no STRUCTURED | The host gives the model `content` only. The plan's reason for omitting it is wrong, and the omission is harmless. |
    | Either call: META | `_meta` reaches the model, so every card would put the whole project in its context. The result shape has to change before M1. |

    Fills **What the model receives**.

14. **Size on mount.** Run this after **Canary**; if `_meta` reached the model, the pad
    lands in its context. One new task per rung, with `pad` at 400000, 1000000, 1300000,
    then 2000000:

    ```text
    Call show_project with show "latest" and pad 400000.
    ```

    Read `pad on mount` in the host facts and `resultBytes` in the log. Stop at the
    first rung that fails and note what happened: an error, a blank card, a shorter pad
    than asked. If `pad on mount` reads `none` and `first result keys:` shows no
    `_meta`, this ladder cannot run: record that and go on. Fills **Size**.

15. **Size on a hidden call.** On a card, tap `Read 400000 characters`, `Read 1000000
    characters`, `Read 1300000 characters`, then `Read 2000000 characters`. The **Size
    ladder** lines give what arrived and any failure. Fills **Size**.

    Judge by `resultBytes`, because each result also carries the project, about 300 KB
    here: the rungs leave the server at about 0.7, 1.3, 1.6 and 2.3 MB, against a
    1.55 MB target.

16. **Image.** On a card, tap `Load an image`. The **Image probe** lines end in
    `loaded`, `the image failed to load` or `refused`. Fills **Image**.

17. **Fullscreen.** New task, call `show_project`.

    1. Read `availableDisplayModes`. With no `fullscreen` there, the card has no `Open
       full screen` button: record that and go to the next step.
    2. Note `mount id`, then tap `Open full screen`. Read the **host-context-changed
       events** lines. A new `mount id` means the switch remounted the frame.
    3. While it is fullscreen, type the first line below in the message box and note
       where the new card lands.
    4. Close it with the host's own control, not `Back to the card`, and read the
       **host-context-changed events** lines again.
    5. In a new task, type the second line. The **Mode requests** lines say whether the
       page's request was answered, rejected or not offered.

    ```text
    Call show_project with show "latest".
    ```

    ```text
    Call show_project with show "file".
    ```

    Fills **Fullscreen**.

18. **Connector off.** New task. Find the per-task connector switch (the help centre
    documents a per-conversation toggle), turn `Genealogy Viewer` off, and type the
    line below. Then check that a second new task still has it on. Fills **Connector
    off for one task**.

    ```text
    Use ToolSearch with the query +show_project and tell me whether you found it.
    ```

19. **`AskUserQuestion`.** New task:

    ```text
    Use AskUserQuestion to ask me which of these to do next: "Search the census", "Check city directories", "Write up what we have". Then tell me the exact text you received as my answer.
    ```

    Pick one. Note how the options show and what text comes back. Fills
    **`AskUserQuestion`**.

20. **Variant plugin.** It carries only the "where the project stands" line for M0.
    The plugin and the `.mcpb` are a pair. If the installed extension predates this
    branch, also install `releases/genealogy-mcp.mcpb`, built by `make mcpb`, by the
    click-path `make cowork-install` prints: Claude Desktop → Settings → Extensions →
    Advanced Settings → Install extension.

    1. Make the branch once, in its own checkout. If it exists, rebase it onto
       `mcp-app-viewer-m0` instead.

       ```
       git worktree add ../mcp-app-router-variant -b mcp-app-router-variant mcp-app-viewer-m0
       cd ../mcp-app-router-variant
       ```

    2. In `packages/engine/plugin/skills/research/SKILL.md`, under "Bounded request or
       job", change the "where the project stands" entry to:

       ```text
       where the project stands (answer from `project_context` in one plain paragraph — no bold, lists, or headers; then call `show_project` with `show: latest`, loaded by bare name with `+show_project` in ToolSearch).
       ```

    3. Commit on that branch only, never a PR, and build the zip. It lands at
       `releases/genealogy-plugin.zip` in that checkout.

       ```
       git commit -am "research: where the project stands calls show_project (variant)"
       node scripts/package-plugin.mjs
       cd -
       ```

    4. Install it by the click-path `make cowork-install` prints, without running the
       target: Claude Desktop → Cowork tab → Customize, remove any Genealogy Research
       plugin, then Add → Upload Plugin → that zip. Fully quit and reopen Claude
       Desktop.

    5. New task:

       ```text
       where does the research stand?
       ```

       A call shows as the paragraph, then a card whose `input:` line shows
       `"show":"latest"`. It may stop at the paragraph: a status question need not load
       the research skill, so the line may go unread. If it does not call the tool, try
       the line below in a new task.

       ```text
       show me the project
       ```

       Keep the line under test alone in its message. Once a line has called the tool,
       ask in the same task:

       ```text
       Tell me the full name of the tool you called.
       ```

    Fills **Card renders** and **Variant line**.

### Leg 2: local

21. **Add the local server.** Back up the config, then add an `mcpServers` key beside
    the ones already there, with `<checkout>` as the absolute path of this checkout.
    The entry has no working-directory setting, so `/bin/sh -c` does the `cd`, and it
    sets `PATH` because Claude Desktop does not read your shell profile.

    ```
    cp "$HOME/Library/Application Support/Claude/claude_desktop_config.json" ~/mcp-probe/claude_desktop_config.backup.json
    ```

    ```json
    "mcpServers": {
      "genealogy-viewer": {
        "command": "/bin/sh",
        "args": [
          "-c",
          "export PATH=/opt/homebrew/bin:$PATH; cd \"<checkout>/packages/engine/mcp-server\" && exec npx tsx viewer/stdio.ts --root \"$HOME/mcp-probe/mcandrew\""
        ]
      }
    }
    ```

    Fully quit and reopen Claude Desktop. This leg's request log is
    `~/Library/Logs/Claude/mcp-server-genealogy-viewer.log`; `server.log` stays silent.

22. **Run the leg.** New task, with the connector off if **Connector off** found a
    switch, so only one `show_project` exists. If both show, name the tool in the
    prompt, and treat a line in `server.log` as the call having gone the wrong way.

    ```text
    Use ToolSearch with the query +show_project to load the tool, then call it with show "latest". Tell me the tool's full name.
    ```

    The client's declared extensions are in this leg's log. Search for `clientInfo`,
    not `initialize`: Claude's wrapper also logs a bare line with that word.

    ```
    grep clientInfo ~/Library/Logs/Claude/mcp-server-genealogy-viewer.log
    ```

    Fills the Local rows of **Card renders** and **Declared extensions**. If no card
    appears, still repeat **Approvals on `show_project`** and **Canary**, write `no card`
    in the Local cells the other steps would fill, and go to leg 3. If one does, repeat
    **Card**, **Approvals on `show_project`**, **Hidden call**, **Canary**, the two size
    steps and **Fullscreen** here, with this leg's log in place of `server.log`. Skip
    **Image**: this leg has no `/img`.

### Leg 3: artifact

The connector stays on.

23. **Publish.** Put the built page in the task's folder:

    ```
    cp apps/mcp-viewer/dist/index.html ~/mcp-probe/mcandrew/viewer-artifact.html
    ```

    New task:

    ```text
    Publish viewer-artifact.html from this folder as an artifact, unchanged, with capabilities { mcp: { servers: [{ server: "Genealogy Viewer", tools: ["read_project_view"] }] } }. Then open it.
    ```

    Does it open beside the task? If the task has no way to publish, record that, then
    publish the same file with the same capabilities from Claude Code and open the link
    in Claude Desktop, so the other artifact answers still get filled. Fills **Artifact**.

24. **Read it.** Allow the connector when the page's first call asks. The page loads
    by one `document` call, so `sources: 5` and `questions: 1` in the report mean a
    whole document came through `payload`. Copy the host facts, tap the four size
    buttons in order, then `Load an image`. The line stamped at the page's first call
    gives the client's declared extensions:

    ```
    grep '"initialize"' ~/mcp-probe/server.log
    ```

    Fills **Card renders**, **Declared extensions**, **What the page sees**, **Size**
    and **Artifact**.

25. **If the app-only tool is refused.** A refusal is a rejected publish, or a
    `not_in_manifest` after you allowed the connector. A size button prints the error
    code on its **Size ladder** line. Record which, then make the plan's change: its
    visibility becomes `["model", "app"]`, with a description telling the model not to
    call it. Restart the server, reconnect if the tool list looks stale, and re-run
    this leg.

    Four results are something else:

    - `server_not_connected`: the connector is off, or its name differs from the
      publish prompt. Fix that and retry.
    - `not_in_manifest` right after you decline the prompt: reload and allow.
    - `use("mcp") resolved null` on the card: this view has no connector access at all.
      Record it under **Artifact**.
    - Claude will not publish because it cannot read the whole file. The Artifact tool
      has it read any file it did not write, here or in Claude Code, and this one is
      about 530,000 characters of minified code. That is not the app-only tool being
      refused, so change no visibility. Publish a small page instead; it prints what
      the page sees, reach, `payload`, the image result and the four size rungs, with
      no buttons to tap.

      ```text
      Write a small HTML page that first prints typeof window.claude, typeof window.claude?.use and window.parent === window. It then awaits window.claude.use("mcp"), calls callTool("Genealogy Viewer", "read_project_view", { part: "document" }, { cache: false }), and prints the keys of result.payload, the length of result.payload.research.sources, and any rejection's code and message. It calls read_project_view the same way with { part: "image", id: "images/probe.jpg" }, shows result.payload.url in an img, and prints that img's load or error result. Last, it calls read_project_view the same way with { part: "document", pad } at pad 400000, 1000000, 1300000 and 2000000, in that order, printing result.payload.pad.length or the error code for each. Publish it with capabilities { mcp: { servers: [{ server: "Genealogy Viewer", tools: ["read_project_view"] }] } } and open it.
      ```

### The real project path

Last, because every member who connected the connector can read the real project for
as long as this runs. Go straight to **Stop** afterwards.

26. **Restart the server.** First remove the `mcpServers` key from **Add the local
    server** and fully quit and reopen Claude Desktop, so only the connector holds
    `show_project`. Then restart the server in terminal 1 at the folder that holds the
    real Cowork project, and open a new task on that project:

    ```
    npx tsx viewer/cli.ts --secret "$(cat ~/.mcp-viewer-secret)" --root "<parent of the real project>" --public-url "$VIEWER_ORIGIN" --port 8090 | tee -a ~/mcp-probe/server.log
    ```

    ```text
    Call show_project with show "latest" and projectPath set to the absolute path of this project's folder.
    ```

    A call counts only if it leaves a `tools/call` line in `server.log`: the local
    server refuses with the same text, so a call that reached it answers nothing. The
    card's `input:` line shows what the model passed. `No project folder … can be
    reached from this viewer` means that path is not inside `--root` on this Mac. Then,
    in a new task, with the folder's name:

    ```text
    Call show_project with show "latest" and projectPath "<folder name>".
    ```

    Fills **`projectPath`**. Record the path's shape with `<folder>` for the name.

### Stop

27. **Turn the funnel off.** A funnel left on stays public, through reboots. Run this
    only on this Mac, never on the sidecar host in `scripts/tailscale-services.sh`.

    ```
    tailscale funnel --https=443 off
    tailscale funnel status
    ```

    The last line prints `No serve config`.

28. **Stop the server** with Ctrl-C in terminal 1.

29. **Put Claude Desktop back.** **Restart the server** already removed the `mcpServers`
    key. Reinstall the usual plugin, and the usual `.mcpb` if **Variant plugin** replaced
    it, by the same click-paths, and fully quit and reopen. Delete the connector if you
    will not re-run soon; with the tunnel off it reaches nothing.

## Record

Read **Approvals** first: it sets how many cards the demo can have. Then **Card
renders**: it is the go/no-go. A `—` cell does not apply on that route. `no card` means
the step needed a card and none rendered, which is an answer.

| Run | |
|---|---|
| Date | |
| Claude Desktop version | |
| macOS version | |
| Commit of `mcp-app-viewer-m0` | |

### Approvals

**Decides:** Decision 3's fallback. If Cowork asks on every card and "always allow"
does not stick, only setup, search, link (when it asks an identity question), conflict,
hypothesis and conclusion get a card, and the router lines shrink to match.

| | Connector | Local |
|---|---|---|
| Task run mode | | |
| `show_project`, first call in a task | | |
| `show_project`, second call | | |
| `show_project`, third call | | |
| `show_project`, next call after "always allow" | | |
| `show_project`, first call in a new task after "always allow" | | |
| A tapped button makes a hidden call | | |
| `read_project_view`, first tap | | |
| `read_project_view`, next tap after "always allow" | | |
| `read_project_view`, first tap in a new task after "always allow" | | |

### Card renders

**Decides:** the go/no-go in Decision 8. If neither a card nor an artifact can show a
project's data in a Cowork task, the build stops. If only the artifact can, the case
file runs as an artifact. If the local route does not render, testers see cards in the
browser tab.

| Route | Renders? | Tool's full name |
|---|---|---|
| Connector, main thread | | |
| Connector, after a ToolSearch load | | |
| Connector, with the variant plugin | | |
| Local | | |
| Artifact (shows the page, not a card) | | — |

### Declared extensions

**Decides:** nothing alone. It explains a card that does not render: a client that
declares no MCP Apps extension never asked for one.

| Route | `clientInfo` | Declared extensions |
|---|---|---|
| Connector | | |
| Local | | |
| Artifact | | |

### What the page sees

**Decides:** whether the page's boot order holds. It checks for an artifact first, so a
card that reports `window.claude.use` as a function would boot on the wrong host.

| Route | `typeof window.claude` | `typeof window.claude?.use` | `window.parent === window` |
|---|---|---|---|
| Connector | | | |
| Local | | | |
| Artifact | | | |

### Fullscreen

**Decides:** where the case file lives. If Cowork offers no fullscreen, it runs as an
artifact.

| | Connector | Local |
|---|---|---|
| `availableDisplayModes` | | |
| `host-context-changed` on entering fullscreen | | |
| `host-context-changed` on the host's own close | | |
| A card opened by a typed request goes straight to fullscreen | | |
| A mode switch remounts the frame | | |
| Where a typed card lands while the file is fullscreen | | |

### Variant line

**Decides:** how the demo opens. If the line does not call `show_project`, the demo
opens with "show me the project".

| | Answer |
|---|---|
| "where does the research stand?" calls `show_project` | |
| "show me the project" calls `show_project` | |

### What the model receives

**Decides:** the plan's "Result shape". What each outcome means is in **Canary** above.

| Strings the model quoted | Connector | Local |
|---|---|---|
| Plain call | | |
| Call with `structuredCanary: true` | | |

### Card receives `_meta`

**Decides:** whether a card is a true snapshot. If it does not receive the result's
`_meta`, it falls back to one `read_project_view` call per mount, which shows the
project as it is now rather than at that step.

| | Connector | Local |
|---|---|---|
| `result _meta arrived` | | |
| `data came from` | | |

### Size

**Decides:** paging. If the largest `resultBytes` accepted is below 1.55 MB, the size
of the largest project's research.json, `document` gains paging.

| Rung | Mount, connector | Mount, local | Hidden call, connector | Hidden call, local | Hidden call, artifact |
|---|---|---|---|---|---|
| 400k characters | | | | | |
| 1M characters | | | | | |
| 1.3M characters | | | | | |
| 2M characters | | | | | |
| Largest `resultBytes` accepted | | | | | |
| What happens past it | | | | | |

### Image

**Decides:** whether a card can show a page image from `/img/<token>`, which Decision 9
needs. An artifact's answer is in **Artifact**.

| | Connector | Local |
|---|---|---|
| The image loads from the declared host | | — |

### `ui/update-model-context`

**Decides:** whether selecting a row in the case file can tell Claude what the
researcher is looking at. It posts nothing either way.

| | Connector | Local |
|---|---|---|
| `updateModelContext offered` | | |

### Connector off for one task

**Decides:** whether a branch test can run beside the organization's connector without
Cowork holding two copies of every tool, as "Local testing" asks.

| | Answer |
|---|---|
| A switch exists, and it holds for one task only | |

### `AskUserQuestion`

**Decides:** the "Named next steps" trial in the router lines.

| | Answer |
|---|---|
| How named options show | |
| The chosen text comes back as the researcher's answer | |

### Artifact

**Decides:** an artifact that cannot reach an app-only tool changes that tool's
visibility to `["model", "app"]`. An artifact that cannot load `/img/<token>` gets a
data URL from `part: "image"`. An artifact that works as well as a card is a separate
decision after M0.

| | Answer |
|---|---|
| Opens beside a Cowork task | |
| Reaches a `visibility: ["app"]` tool | |
| Its `payload` carries a whole document | |
| Loads an image from `/img/<token>` | |

### `projectPath`

**Decides:** whether a live run can pass the path the model holds, or has to use a bare
folder name under `--root`.

| | Answer |
|---|---|
| Shape of the path the model passes (`<folder>` for the name) | |
| Readable on the Mac | |
| A bare folder name works | |
