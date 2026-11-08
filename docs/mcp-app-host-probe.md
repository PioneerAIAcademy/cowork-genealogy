# MCP App host probe

**The repo is public: never write a connector URL, a tunnel hostname, a secret or a
real person's data in this file.**

M0 of `docs/plan/mcp-app-viewer.md`. The run sheet walks the live legs in claude.ai chat
and Desktop Chat; the record holds the answers. M0 closes when every row of the record
has an answer, and a failure is an answer.

## Run sheet

Work top to bottom on the Mac that holds the project folders, from the root of a
checkout of `main`. Terminal 1 holds the server, terminal 2 everything
else. A `text` block is what you type. Wherever a step says a Cowork task or a new task,
use a new conversation in Desktop Chat or claude.ai chat, because Cowork is not tested
further. A new conversation means exactly that: an earlier result in the same one spoils
the next probe. Each step names the
record blocks it fills.

Claude Desktop's button is **New**. Attaching a folder makes it a Cowork task, a cloud
`cse_` session: `claude-code` connects to the server seconds after the folder is
granted. With no folder it is a chat, which on 2026-11-08 ran as a cloud session too,
and its `claude-code` client connects just before its first tool call. Only an
Incognito chat at claude.ai opens no client of its own.

### Set up

1. **Build the page,** and fill the **Run** block in the record. Open Claude Desktop
   first and let it update. That does not pin what a task runs: a default Cowork task
   runs in the cloud, and the page that draws its card loads from claude.ai, so both
   can change without a Desktop update.

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
   curl -s "http://127.0.0.1:8090/$(cat ~/.mcp-viewer-secret)/mcp" -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq -r '.result.tools[].name'
   ```

   Expect `show_project` and `read_project_view`. Then open the bare hostname on a
   device that is off the tailnet, such as a phone on cellular: expect a 404, not a 502.
   Do not test the hostname from this Mac, where a request to it can time out. A new
   hostname can take a few minutes to answer.

8. **Add the connector.** Put the URL on the clipboard, so it is never typed into a
   file:

   ```
   printf '%s/%s/mcp' "$VIEWER_ORIGIN" "$(cat ~/.mcp-viewer-secret)" | pbcopy
   ```

   On the organization's connectors admin page, add a custom connector named exactly
   `Genealogy Viewer`, paste the URL, and set no sign-in. Then connect it on your own
   account under Settings → Connectors. A connector can also go straight on a personal
   account; record which one was used in **Run**.

   Then fully quit and reopen Claude Desktop. Until then it does not list a connector
   added on the website: the tool still runs, but no card draws and nothing says why.
   Check that the connector's page lists `Show project` under **Interactive tools** and
   `Read project view` under **App-only tools**.

   - The name is the tool's label, and the artifact's capability names it. The model
     may report `mcp__Genealogy_Viewer__…`; record what it says.
   - The admin page has no rename, and an organization cannot add two connectors with
     the same URL. To fix the name, delete the connector, then re-add it.
   - `tools/list` is cached per connector, so after changing a tool's metadata, remove
     and re-add the connector.

### Leg 1: connector

Follow the log in a spare terminal; a hidden call shows only there.

```
tail -f ~/mcp-probe/server.log
```

**Run the controls first.** Before any Cowork task, type the **Card** line below in a
new chat at claude.ai, then in a new Desktop Chat. A card in both proves the server, so
a missing card in Cowork is about Cowork. An open bug report says a Cowork session can
replace the connector's shared tool list and stop cards in Chat, so reconnect the
connector if Chat stops drawing them.

Open every conversation with the connector on.

9. **Card.** New task:

   ```text
   Call show_project with show "latest". Tell me the tool's full name.
   ```

   Read where the task ran, and put it in **Run**. `grantRemoteSessionFolders: cse_` or
   `[remote-bash]` means the cloud; a new `local_*.json` under
   `local-agent-mode-sessions` means a local task. A cloud task with no folder and no
   bash can leave no line. `Installing SDK` in `cowork_vm_node.log` does not answer this:
   it prints Desktop's pinned build on every VM start, and a cloud task starts the VM
   only for bash.

   ```
   grep -E 'grantRemoteSessionFolders|\[remote-bash\]|\[HostLoop\] sdkOptions' ~/Library/Logs/Claude/main.log | tail -3
   ```

   Does a card appear in the conversation? The card prints a report as selectable
   text, and its **Host facts** lines hold the page-side answers. Copy single values
   into the record, never the whole report: its **Card** section names the project.
   `result _meta arrived` says whether the result's `_meta` reached the card, and
   `first result keys:` names what the result did hold. The size ladder and image
   buttons are on the card too. The log shows whether the page asked for the card: the
   first card makes one `resources/read`, close to its `tools/call`: on 2026-11-08 it came
   2.6 s after the call on this server and about 1.4 s before it on the sign-in probe.
   Later cards on the same connector in the same app may draw from a cached page and
   make none.

   ```
   grep -c 'resources/read' ~/mcp-probe/server.log
   ```

   `Anthropic/ClaudeAI` connects when the connector does. Each ordinary conversation's
   `claude-code` client connects about 1.5 s before its first tool call, after a
   harmless `server/discover` 400. An Incognito chat opens none.

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
    | Second call: STRUCTURED, no CONTENT | `structuredContent` replaces `content`. `show_project` keeps omitting it. |
    | Second call: STRUCTURED and CONTENT | The host passes both. `show_project` keeps omitting it, since anything there reaches the model. |
    | Second call: CONTENT, no STRUCTURED | The host gives the model `content` only, and the omission is harmless. On a cloud task a server-side gate can also produce this, so it does not prove a different host. |
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

    In Chrome on a device on your tailnet, the image fails with `Permission was denied
    for this request to access the local address space`, and no `/img` line reaches the
    log. The hostname resolves to a private Tailscale address there, and Chrome will not
    let a public page load from one. Test from Claude Desktop, or from a browser off the
    tailnet. A server on a public address is not affected. The self-hosted server is also
    behind Funnel, so expect the same block there.

    Then tap `Open a link`. The **Link probe** line says how long the host took to answer,
    or that it refused. Note whether Claude asks before opening the page, and whether the
    page opens. Fills **`openLink`**.

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

18. **Connector off.** New conversation. Find the connector switch under the message
    box's `+`, then Connectors, turn `Genealogy Viewer` off, and type the line below.
    Then check whether a second new conversation has it on, and switch it back on
    there, because it stays off until you do. Fills **Connector off for one
    conversation**.

    ```text
    Use ToolSearch with the query +show_project and tell me whether you found it.
    ```

19. **`AskUserQuestion`.** New conversation:

    ```text
    Use AskUserQuestion to ask me which of these to do next: "Search the census", "Check city directories", "Write up what we have". Then tell me the exact text you received as my answer.
    ```

    Pick one. Note how the options show and what text comes back. Fills
    **`AskUserQuestion`**.

20. **Variant plugin.** This step runs on the sign-in probe
    (`dev/probe-connector-server.ts`), not on `Genealogy Viewer`: a chat has no project
    folder and the thin server has no `project_context`, while the probe lists every tool
    under one connector. The plugin is the local branch `mcp-app-router-variant`, one
    commit on `main`, never a PR. In `packages/engine/plugin/skills/research/SKILL.md`,
    its description no longer sends a status question away from the skill, and under
    "Bounded request or job", its "where the project stands" entry reads:

    ```text
    where the project stands (answer from `project_context` in one plain paragraph — no bold, lists, or headers; then call `show_project` with `show: latest` and the same `projectPath`, loaded by bare name with `+show_project` in ToolSearch).
    ```

    1. Build the zip in its own checkout. If `main` has moved, rebase the branch onto it
       first. The zip lands at `releases/genealogy-plugin.zip` in that checkout.

       ```
       git worktree add ../mcp-app-router-variant mcp-app-router-variant
       cd ../mcp-app-router-variant
       node scripts/package-plugin.mjs
       cd -
       ```

    2. Install it at claude.ai's plugin page: remove the plugin that is there, then Add,
       Upload plugin, and pick that zip. Fully quit and reopen Claude Desktop.

    3. Connect the sign-in probe, then start a new conversation. Turn `Genealogy Viewer`
       off in it, as in **Connector off**, so only the probe offers `show_project`, and
       switch it back on after this step. If there is no switch, a `show_project` line
       in `server.log` counts as a call too.

       ```text
       where does the research stand?
       ```

       Read a call from the probe's `show_project` log line. On the probe `project_context`
       is a stub that says it did nothing, so the paragraph will be empty of facts: only
       whether `show_project` is called counts. It may stop at the paragraph:
       `project_context`'s own description says to answer in one paragraph and nothing
       else, so a no may come from that tool and not from the line. Run the line below
       in a new conversation whatever this one did.

       ```text
       show me the project
       ```

       Keep the line under test alone in its message. Once a line has called the tool,
       ask in the same conversation:

       ```text
       Tell me the full name of the tool you called.
       ```

    Fills **Card renders** and **Variant line**.

### Leg 2: artifact

Switch `Genealogy Viewer` back on if step 20 left it off.

21. **Publish.** A chat has no folder, so copy the built page out to attach it:

    ```
    cp apps/mcp-viewer/dist/index.html ~/mcp-probe/viewer-artifact.html
    ```

    New conversation, with that file attached:

    ```text
    Publish the attached file as an artifact, unchanged, with capabilities { mcp: { servers: [{ server: "Genealogy Viewer", tools: ["read_project_view"] }] } }. Then open it.
    ```

    Does it open beside the conversation? If the conversation has no way to publish,
    record that, then publish the same file with the same capabilities from Claude Code
    and open the link in Claude Desktop, so the other artifact answers still get filled.
    Fills **Artifact**.

22. **Read it.** Allow the connector when the page's first call asks. The page loads
    by one `document` call, so `sources: 5` and `questions: 1` in the report mean a
    whole document came through `payload`. Copy the host facts, tap the four size
    buttons in order, then `Load an image`. The line stamped at the page's first call
    gives the client's declared extensions. The artifact's call may log no `initialize`
    line; if so, record that.

    ```
    grep '"initialize"' ~/mcp-probe/server.log
    ```

    Fills **Card renders**, **Declared extensions**, **What the page sees**, **Size**
    and **Artifact**.

23. **If the app-only tool is refused.** A refusal is a rejected publish, or a
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
      about 660,000 characters of minified code. That is not the app-only tool being
      refused, so change no visibility. Publish a small page instead; it prints what
      the page sees, reach, `payload`, the image result and the four size rungs, with
      no buttons to tap.

      ```text
      Write a small HTML page that first prints typeof window.claude, typeof window.claude?.use and window.parent === window. It then awaits window.claude.use("mcp"), calls callTool("Genealogy Viewer", "read_project_view", { part: "document" }, { cache: false }), and prints the keys of result.payload, the length of result.payload.research.sources, and any rejection's code and message. It calls read_project_view the same way with { part: "image", id: "images/probe.jpg" }, shows result.payload.url in an img, and prints that img's load or error result. Last, it calls read_project_view the same way with { part: "document", pad } at pad 400000, 1000000, 1300000 and 2000000, in that order, printing result.payload.pad.length or the error code for each. Publish it with capabilities { mcp: { servers: [{ server: "Genealogy Viewer", tools: ["read_project_view"] }] } } and open it.
      ```

### Stop

24. **Turn the funnel off.** A funnel left on stays public, through reboots. Run this
    only on this Mac, never on the sidecar host in `scripts/tailscale-services.sh`.

    ```
    tailscale funnel --https=443 off
    tailscale funnel status
    ```

    The last line prints `No serve config`.

25. **Stop the server** with Ctrl-C in terminal 1.

26. **Put Claude Desktop back.** Reinstall the usual plugin by the same click-path, and
    fully quit and reopen. Delete the connector if you will not re-run soon; with the
    tunnel off it reaches nothing.

## Record

Read **Approvals** first: it sets how many cards the demo can have. Then **Card
renders**: it says which surfaces draw a card. **What the model receives**, **Fullscreen**,
**Size**, **`openLink`** and **`projectPath`** gate the fold (Decision 8), so each needs an
answer in claude.ai chat and Desktop Chat. Name the surface in the cell. A
`—` cell does not apply on that route. `no card` means the step needed a card and none rendered, which
is an answer.

| Run | |
|---|---|
| Date | 2026-11-05 and 2026-11-06; the rest on 2026-11-08 |
| Claude Desktop version | 4.16336.0; 4.23118.0 on 2026-11-08 |
| Where the task ran (cloud or local), and whether it had a folder | Cloud (`cse_` session), with a folder on this Mac. On 2026-11-08 an ordinary chat with no folder, in Desktop or at claude.ai, was a cloud session too (`E=remote_cowork`, `T=cloud_default`) |
| Account the connector is on (organization or personal) | Personal for `Genealogy Viewer`. On 2026-11-08 the sign-in probe's connector was added from Desktop's Customize page on the same account, which is on the Ultra plan |
| macOS version | 15.8.2 |
| Commit of the viewer server | `5e61d3b5c` on `mcp-app-viewer-m0`, then `9a64649b1` on 2026-11-06; `6dd95fe80` on `mcp-app-fold` on 2026-11-08. The sign-in probe ran from PR #4308 at `fc66f4285` |

### Approvals

**Decides:** Decision 3's fallback. If Cowork asks on every card and "always allow"
does not stick, only setup, search, link (when it asks an identity question), conflict,
hypothesis and conclusion get a card, and the router lines shrink to match.

| | Connector |
|---|---|
| Task run mode | Cloud (`cse_` session) |
| `show_project`, first call in a task | Asked; allowed once |
| `show_project`, second call | Asked |
| `show_project`, third call | Asked; chose "always allow" |
| `show_project`, next call after "always allow" | No prompt |
| `show_project`, first call in a new task after "always allow" | No prompt |
| A tapped button makes a hidden call | Yes |
| `read_project_view`, first tap | No prompt |
| `read_project_view`, next tap after "always allow" | Never asked |
| `read_project_view`, first tap in a new task after "always allow" | Never asked, in any new task |
| `show_project`, first call in each new chat, 2026-11-08 | Asked, at claude.ai and in Desktop Chat |
| "Always allow" chosen at the prompt, Desktop Chat, 2026-11-08 (`record_read`) | Does not stick: asked again on the next two calls, and the connector's page still showed Needs approval |
| "Always allow" set on the connector's page, Desktop Chat, 2026-11-08 (`record_read`, `record_search`) | No prompt, from the main thread and from an agent, in an open conversation, a new one and after restarting Desktop |
| Bulk allow on the connector's page | One control per group: Interactive tools, Read-only tools and Other tools. None covers every tool, and App-only tools have none |

### Card renders

**Decides:** which surfaces draw a card. Before calling a missing card final, check that
Claude Desktop was restarted after the connector was added, and read the table below.

| Route | Renders? | Tool's full name |
|---|---|---|
| Control: claude.ai chat | Yes | Shown as `Genealogy Viewer show_project` |
| Control: Desktop Chat | Yes, only after restarting Desktop | `mcp__Genealogy_Viewer__show_project` |
| Connector, task with a folder on this Mac | Yes, after a ToolSearch load, on a project with one small document | `mcp__Genealogy_Viewer__show_project` |
| Connector, task with no folder | Yes. **New** with no folder starts a Desktop Chat | `mcp__Genealogy_Viewer__show_project` |
| Connector, a chat opened after a Cowork task, with no reconnect (`anthropics/claude-code` #103924) | Yes, in Desktop Chat and claude.ai | Not read: Cowork is not tested |
| Connector, a chat that moved to a cloud session | No chat moved on 2026-11-08. An ordinary chat in Desktop or at claude.ai was a cloud session from its first call (`E=remote_cowork`, `T=cloud_default`), and an Incognito chat ran no shell. Cards drew in all three | `mcp__Genealogy_Research__show_project` |
| Connector, Claude mobile app (`anthropics/claude-ai-mcp` #1085) | Yes, in the iPhone app 1.261104.19, and a tap on the card made a hidden call | `mcp__Genealogy_Research__show_project` |
| Connector, claude.ai Incognito chat | Yes | `mcp__Genealogy_Research__show_project` |
| Connector, after a ToolSearch load | Yes: `show_project` is deferred on all three surfaces | `mcp__Genealogy_Viewer__show_project` |
| Connector, with the variant plugin | Yes, from "show me the project" in Desktop Chat | `mcp__Genealogy_Research__show_project` |
| Artifact (shows the page, not a card) | Yes, in Desktop Chat and in Chrome at claude.ai | — |

| You see | `resources/read` lines | It means |
|---|---|---|
| Card | One for the first card; none when the app drew it from its cached page | The route works. |
| Plain tool row | None | The page found no connector for the row. Restart Claude Desktop and retry. |
| Plain tool row after a restart | None | The page refused the row. Run the same line in a task with no folder, then with another MCP App connector. |
| Empty frame or error | None | The read failed before our server. |
| Empty frame or error | One or more | The read arrived. Check the sandbox and the page's own errors. |

### Declared extensions

**Decides:** nothing alone. `clientInfo` is Anthropic's client, not the task's Claude
Code. `Anthropic/ClaudeAI` declaring the extension shows the page asked for apps. A
`claude-code` line that declares none explains nothing, because the page reads the
resource itself.

| Route | `clientInfo` | Declared extensions |
|---|---|---|
| Connector | `Anthropic/ClaudeAI` 1.0.0 at connect; `claude-code` 2.1.318 when the Cowork task started | `io.modelcontextprotocol/ui` from the first; none from the second, and the card still rendered |
| Connector, 2026-11-06 | `claude-code` 2.1.319-ccs, about 1.5 s before each conversation's first tool call, on all three surfaces. On 2026-11-05 a chat's calls had no such line | `io.modelcontextprotocol/ui` |
| Connector, 2026-11-08 | `claude-code` 2.1.320-ccs in each Desktop Chat conversation, on this server and on the sign-in probe. An ordinary claude.ai chat also opened a client of its own, version not read. An Incognito chat opened none: its calls ran on a session already open | `io.modelcontextprotocol/ui`, read in Desktop Chat |
| Artifact | `Claude` 1.0, at the page's first call | None |

### What the page sees

**Decides:** whether the page's boot order holds. It checks for an artifact first, so a
card that reports `window.claude.use` as a function would boot on the wrong host.

| Route | `typeof window.claude` | `typeof window.claude?.use` | `window.parent === window` |
|---|---|---|---|
| Connector | `undefined` | `undefined` | `false` |
| Artifact | `object` | `function` | `false` |

### Tools on each surface

**Decides:** what research a chat user can get. The first four rows are the model's own
list on one account with the plugin installed. The last two were measured on the sign-in
probe on 2026-11-08: a plugin agent's reply ends with a heading only its instructions
hold, and the hook binds when the main thread's `record_search` is refused and never
reaches the probe. An ordinary chat on either surface ran as a cloud session with the
account's plugins synced from claude.ai. An Incognito chat is a plain chat.

| | Desktop Chat | claude.ai | claude.ai Incognito | Cowork task |
|---|---|---|---|---|
| `Agent`, `Bash` and `Skill` | Yes | Yes | `Skill` only | Yes |
| The `genealogy-research:research` skill | Yes | Yes | Yes | Yes |
| `show_project` | Deferred | Deferred | Not read | Deferred |
| `read_project_view` | Not listed | Not listed | Not read | Not listed |
| A plugin agent spawns | Yes | Yes, 3 of 3 on the first message | No: no `Agent` tool | — |
| The plugin's hook binds | Yes | Yes | No: `record_search` reached the probe twice | — |

With the skill and no agent, an Incognito chat declined "Research the parents of …",
saying its research agents are not available there, and answered a request for a plan
from the main thread, with nothing saved.

### Fullscreen

**Decides:** where the case file lives. If Cowork offers no fullscreen, it runs as an
artifact.

| | Connector |
|---|---|
| `availableDisplayModes` | `inline, fullscreen`, on all three surfaces |
| `host-context-changed` on entering fullscreen | Yes, `displayMode fullscreen`, on all three |
| `host-context-changed` on the host's own close | Yes, `displayMode inline`, on all three. The host's control is an X at the upper right |
| A card opened by a typed request goes straight to fullscreen | Yes, with `show: "file"` and no tap, on all three |
| A mode switch remounts the frame | No, on all three: one `mount id`, and the link probe's result survives |
| Where a typed card lands while the file is fullscreen | It replaces the old card in the full screen view, on all three. The old card gets `displayMode inline` about 2 s after the call. Both cards stay in the conversation |
| What a card that lands in the full screen view reports | `fullscreen` from its first event, with `Back to the card` showing, on all three. It is a new mount. The X sends it `inline` with no remount |

### Variant line

**Decides:** how the demo opens. If the line does not call `show_project`, the demo
opens with "show me the project". Read on the sign-in probe, from its `show_project` log
line.

| | Answer |
|---|---|
| "where does the research stand?" calls `show_project` | No, in Desktop Chat. Claude called `project_list` and `project_context` and answered in one paragraph. The research skill never loaded, so the line went unread |
| "show me the project" calls `show_project` | Yes, in Desktop Chat, after `project_list` and with no research skill loaded: the tool's own description was enough |

### What the model receives

**Decides:** the plan's "Result shape". What each outcome means is in **Canary** above.

| Strings the model quoted | Connector |
|---|---|
| Plain call | `CANARY-CONTENT-K7Q2` only, on all three surfaces, from the replies to the plain and `pad` calls |
| Call with `structuredCanary: true` | `CANARY-CONTENT-K7Q2` only, on all three surfaces. The result carried 80 more bytes |
| The server's `instructions` (`CANARY-INSTRUCTIONS-P3V8`), 2026-11-08 | None before a tool call, at claude.ai, in Incognito and in Desktop Chat; the model quoted them once tool calls had run, on all three. In Incognito the host attached them to the conversation's first tool result, marked as written by the server, and the model once withheld them there as embedded text |

### Card receives `_meta`

**Decides:** whether a card is a true snapshot. If it does not receive the result's
`_meta`, it falls back to one `read_project_view` call per mount, which shows the
project as it is now rather than at that step.

| | Connector |
|---|---|
| `result _meta arrived` | Yes, up to 999,947 bytes, on all three surfaces. No at 1,299,948 bytes |
| `data came from` | `result _meta`, or a `read_project_view` call when `_meta` did not arrive |
| A reopened conversation's card gets the result's `_meta` again | Yes, in Desktop Chat and claude.ai, at up to 799,947 bytes. It is a new mount, and the tool input comes again too |

### Size

**Decides:** paging. If the largest `resultBytes` accepted is below 1.55 MB, the size
of the largest project's research.json, `document` gains paging.

| Rung | Mount, connector | Hidden call, connector | Hidden call, artifact |
|---|---|---|---|
| 400k characters | — | Whole, 699,798 bytes, 2.0 to 7.1 s | Whole, 699,807 bytes, 6.5 s, in Desktop Chat |
| 500k characters | Arrives, 799,947 bytes, on all three surfaces | — | — |
| 700k characters | Arrives, 999,947 bytes, on all three surfaces | — | — |
| 1M characters | `_meta` dropped at 1,299,948 bytes, on all three surfaces | Whole, 1,299,798 bytes, 19.5 s, in Cowork | Whole, 1,299,806 bytes, 2.1 s |
| 1.3M characters | `_meta` dropped at 1,599,948 bytes, on all three surfaces | Whole, 1,599,798 bytes, 14.5 s, in Cowork | Whole, 1,599,806 bytes, 2.3 s |
| 2M characters | — | Whole, 2,299,798 bytes: 8.0 s in Cowork, 3.1 s on claude.ai, 3.8 s in Desktop Chat | Whole, 2,299,806 bytes, 28.5 s |
| Largest `resultBytes` accepted | 999,947 | 2,299,798 so far, on all three surfaces | 2,299,806 |
| What happens past it | The host drops `_meta` with no error, and the result's keys are `content, isError`. The card's one fallback read fills it, 2 to 3 s later. Desktop Chat once took 20.8 s, at 1,599,948 bytes. The model is told nothing | Not reached: 2M was the top rung | Not reached: 2M was the top rung |

### Image

**Decides:** whether a card can show a page image from `/img/<token>`, which Decision 9
needs. An artifact's answer is in **Artifact**.

| | Connector |
|---|---|
| The image loads from the declared host | Yes, 1200 x 675, in a Cowork task, Desktop Chat and claude.ai off the tailnet. Blocked in Chrome on a tailnet device |

### `openLink`

**Decides:** whether a card can open a link to a FamilySearch page, which the display
rules' links need.

| | Connector |
|---|---|
| The page opens | Yes. Desktop Chat: Desktop or Chrome, by choice. claude.ai: a new tab. Cowork: a side panel beside the conversation |
| Claude asks first | Desktop Chat: yes, Desktop or Chrome. claude.ai: yes, an "Open external link" dialog naming the URL. Cowork: no |
| `Link probe` line | Answered in 20,166 ms in Desktop Chat, 3,287 ms on claude.ai and 1,897 ms in Cowork |

### Door refusals

**Decides:** whether the door's 400, 403 and 503 stay HTTP errors or become tool errors on
the connector path. A 401 stays HTTP, because that is what makes Claude refresh. Read on
the sign-in probe with the stub card: a project path picks the refusal, and the card's
`Door refuses` buttons send the same three.

| | 400 bad path | 403 not yours | 503 unavailable |
|---|---|---|---|
| `show_project`: what the researcher sees | A failed tool row carrying our message, "projectPath must be /proj_ followed by 16 lowercase hex characters" | A failed row with the host's text instead of ours: "MCP server returned 403 Forbidden. The request may have been blocked by a firewall or security service." | A failed row with only the host's "Error POSTing to endpoint: Service Unavailable" |
| `show_project`: a card draws | No. A frame shows for about a second or less, then the failed row replaces it | No, the same | No, the same |
| `show_project`: what the model does next | Quotes the error and explains the path's format. No retry | Quotes it and says the connector refused the call; in Desktop Chat it guessed at a sign-in, permission or network block. No retry | Quotes it and calls it an outage on the server's side, not a missing project. No retry |
| Hidden call: what the card shows | A tool error carrying our message | A rejected call, `-32603`, with the host's `permission_error` text (`mcp_request_blocked`) | A rejected call, `-32603`, with our message, "Project authorization is unavailable.", inside the host's text |
| The connector still works afterwards, with no new sign-in | Yes | Yes | Yes |

Read on 2026-11-08, the same at claude.ai and in Desktop Chat, on one token throughout.
Calls after the 403 worked with no reconnect.

### `ui/update-model-context`

**Decides:** whether selecting a row in the case file can tell Claude what the
researcher is looking at. It posts nothing either way.

| | Connector |
|---|---|
| `updateModelContext offered` | Yes, on all three surfaces |

### Connector off for one conversation

**Decides:** whether a branch test can run beside the organization's connector without
holding two copies of every tool, as "Local testing" asks.

| | Answer |
|---|---|
| A switch exists, and it holds for one conversation only | A switch exists in Desktop Chat: the message box's `+`, then Connectors, one toggle per connector. It does not hold for one conversation: the connector stays off in every new conversation until switched back on. In the conversation where it was switched off, a tool already listed was removed |

### `AskUserQuestion`

**Decides:** the "Named next steps" trial in the router lines.

| | Answer |
|---|---|
| How named options show | A numbered list to click, then a "Something else" line for the researcher's own words and a Skip button, in Desktop Chat. Only labels were tested, not descriptions |
| The chosen text comes back as the researcher's answer | Yes, word for word: `"Which of these should we do next?"="Search the census"`, inside "Your questions have been answered: … You can now continue with these answers in mind." |

### Artifact

**Decides:** an artifact that cannot reach an app-only tool changes that tool's
visibility to `["model", "app"]`. An artifact that cannot load `/img/<token>` gets a
data URL from `part: "image"`. An artifact that works as well as a card is a separate
decision after M0.

| | Answer |
|---|---|
| Opens beside the conversation | Yes, in a pane at the right of a wide Desktop window; a narrow window shows it in place of the conversation. Desktop Chat published the page itself in two approved steps, publish and then declare capabilities. Told to open it, it opened it in Chrome through Claude in Chrome (two approvals) rather than beside the conversation |
| Reaches a `visibility: ["app"]` tool | Yes, in Chrome and in Desktop, after one consent ("This artifact uses connectors": Genealogy Viewer, "Can only read", 1 tool) that carried over between them. Before the capability was declared, `use("mcp")` resolved `null` |
| Its `payload` carries a whole document | Yes: 5 sources and 1 question, 299,797 bytes |
| Loads an image from `/img/<token>` | No. The artifact page's CSP sets `img-src` to its own frame origin, `data:` and `blob:`, so the request never leaves the page. Chrome's console names the CSP, so it is not the tailnet |

### `projectPath`

**Decides:** that the project's id gets where it needs to go. On the tool server
`projectPath` is the project's database id, the `/proj_<16 hex>` value from `project_list`.
Read on the sign-in probe, from the `project_path` on its `show_project` and `hidden_call`
log lines.

| | Answer |
|---|---|
| The model passes the `/proj_` value it got from `project_list` | Yes, at claude.ai and in Desktop Chat |
| The card passes the same value to `read_project_view` | Yes, at claude.ai and in Desktop Chat |
