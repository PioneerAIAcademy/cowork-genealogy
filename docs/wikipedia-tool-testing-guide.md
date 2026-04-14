# Wikipedia Tool Testing Guide

This guide walks you through testing the wikipedia_search tool after it's built.
Follow each layer in order. Don't skip ahead — each layer catches different problems.

## Before You Start

Make sure the server builds without errors:

```bash
cd /home/gennesis/cowork-genealogy/mcp-server
npm run build
```

If you see errors, fix them before continuing.

---

## Layer 1: MCP Inspector

**What this tests:** Does the tool schema work? Can the tool be called?

**Time needed:** 5 minutes

### Steps

1. Open a terminal in WSL2

2. Run this command:

   ```bash
   cd /home/gennesis/cowork-genealogy/mcp-server
   npx @modelcontextprotocol/inspector node build/index.js
   ```

3. A browser window will open showing MCP Inspector

4. Look for "wikipedia_search" in the tools list on the left side
   - If you don't see it: check your index.ts — the tool isn't registered

5. Click on "wikipedia_search" to select it

6. In the input field, type: `{"query": "Albert Einstein"}`

7. Click "Call Tool" or "Execute"

8. You should see a response with:
   - A title ("Albert Einstein")
   - An extract (a paragraph about Einstein)
   - A URL (link to Wikipedia)

### What success looks like

You get back JSON with title, extract, and url fields filled in.

### What failure looks like

- Tool doesn't appear in the list → check index.ts imports and registration
- Error when calling → check your fetch code and error handling
- Empty response → check how you're parsing the Wikipedia API response

### When to move on

Move to Layer 2 when you can successfully call the tool and get Einstein's summary back.

---

## Layer 2: Claude Code as Client

**What this tests:** Does Claude understand when and how to use the tool?

**Time needed:** 10 minutes

### Steps

1. Open a NEW terminal window (keep Inspector running if you want, or close it)

2. Create a test folder and go there:

   ```bash
   mkdir -p ~/mcp-test-scratch
   cd ~/mcp-test-scratch
   ```

3. Add your server to Claude Code in this folder:

   ```bash
   claude mcp add --transport stdio genealogy-dev -- node /home/gennesis/cowork-genealogy/mcp-server/build/index.js
   ```

4. Start Claude Code:

   ```bash
   claude
   ```

5. Ask Claude to use your tool:

   ```
   "Use genealogy-dev to search Wikipedia for the Treaty of Westphalia"
   ```

6. Watch what happens:
   - Does Claude decide to use the tool?
   - Does it pass the right arguments?
   - Does it show you the result?

### What success looks like

Claude calls wikipedia_search with query "Treaty of Westphalia" and shows you a summary about the Peace of Westphalia.

### What failure looks like

- Claude doesn't use the tool → your tool description might be unclear, reword it
- Claude passes wrong arguments → your parameter description might be confusing
- Claude uses the tool but gets an error → check your error messages, make them helpful

### Troubleshooting

If you change the server code:

1. Rebuild: `cd /home/gennesis/cowork-genealogy/mcp-server && npm run build`
2. In Claude Code, type `/mcp` to reconnect to the server
3. Try your request again

### When to move on

Move to Layer 3a when Claude successfully uses the tool and returns Wikipedia information.

---

## Layer 3a: Cowork via WSL2 (Dev Environment Test)

**What this tests:** Does everything work in Cowork when running through the WSL2 bridge?

**Time needed:** 15 minutes

**Prerequisite:** Claude Desktop must be installed on Windows.

### How this works

Your code lives in WSL2 (Linux). Claude Desktop runs on Windows. The config tells Claude Desktop to use `wsl.exe` to reach into WSL2 and run your server. This is how you test during development.

```
Claude Desktop (Windows) → wsl.exe → Your server (WSL2) → Wikipedia API
```

### Steps

1. Find Claude Desktop's config file on the WINDOWS side (not in WSL2):

   ```
   Press Windows+R, type: %APPDATA%\Claude
   Open the file: claude_desktop_config.json
   ```

   If the file doesn't exist, create it.

2. Edit the file to add your server. The file should look like this:

   ```json
   {
     "mcpServers": {
       "genealogy-dev": {
         "command": "wsl.exe",
         "args": [
           "-d", "Ubuntu",
           "--cd", "/home/gennesis/cowork-genealogy/mcp-server",
           "--",
           "node", "build/index.js"
         ]
       }
     }
   }
   ```

   **NOTE:** If you have a different WSL distro name, replace "Ubuntu" with yours.
   To check your distro name, run `wsl.exe -l` in PowerShell.

3. FULLY restart Claude Desktop:
   - Look for Claude in the Windows system tray (bottom right, near the clock)
   - Right-click the Claude icon
   - Click "Quit" or "Exit"
   - Open Claude Desktop again from the Start menu

4. Open a Cowork session:
   - In Claude Desktop, click on Cowork
   - Point it at any folder

5. Test the tool:

   ```
   "Search Wikipedia for the Treaty of Westphalia"
   ```

### What success looks like

Claude uses the wikipedia_search tool and shows you information about the Peace of Westphalia, including a summary and link.

### What failure looks like

- Claude doesn't see the tool → check your config file for typos, restart Claude Desktop fully
- Connection error → check that your server builds and runs: `cd /home/gennesis/cowork-genealogy/mcp-server && node build/index.js` (it should hang waiting for input, Ctrl+C to exit)
- Tool fails → check the logs at `%APPDATA%\Claude\logs\mcp-server-genealogy-dev.log`

### When to move on

Move to Layer 3b after you confirm Cowork works with the WSL2 bridge.

---

## Layer 3b: Cowork via Native Windows (User Install Test)

**What this tests:** Does everything work when installed the way a real Windows user would install it?

**Time needed:** 20-30 minutes (includes installing Node.js on Windows if not already installed)

**Why this matters:** Layer 3a runs your code in Linux (WSL2). But most Windows users don't have WSL2 — they'll run your server directly on Windows. This layer catches bugs that only appear on native Windows:

- Path separator issues (`/` vs `\`)
- File permission differences
- Command differences (`npx` vs `npx.cmd`)

### Prerequisites

You need Node.js installed on Windows (not just in WSL2):

1. Open PowerShell (not WSL2)
2. Check if Node is installed: `node --version`
3. If not installed, download from https://nodejs.org/ and install

### Steps

1. Open PowerShell (not WSL2, not CMD)

2. Navigate to your project. From Windows, WSL2 files are at `\\wsl$\`:

   ```powershell
   cd \\wsl$\Ubuntu\home\gennesis\cowork-genealogy\mcp-server
   ```

   Or clone/copy the project to a native Windows location like `C:\projects\`.

3. Install dependencies and build (from PowerShell):

   ```powershell
   npm install
   npm run build
   ```

   Watch for errors here — this is where cross-platform bugs often appear.

4. Update Claude Desktop config for native Windows. Edit `%APPDATA%\Claude\claude_desktop_config.json`:

   ```json
   {
     "mcpServers": {
       "genealogy-native": {
         "command": "node",
         "args": ["C:\\path\\to\\mcp-server\\build\\index.js"]
       }
     }
   }
   ```

   **IMPORTANT:** Use the full Windows path with double backslashes, or forward slashes:
   - `"C:\\Users\\you\\projects\\mcp-server\\build\\index.js"` (double backslash)
   - `"C:/Users/you/projects/mcp-server/build/index.js"` (forward slash also works)

   **NOTE:** If accessing WSL2 files from Windows, the path would be:
   - `"\\\\wsl$\\Ubuntu\\home\\gennesis\\cowork-genealogy\\mcp-server\\build\\index.js"`

5. FULLY restart Claude Desktop (system tray → Quit → reopen)

6. Open Cowork and test:

   ```
   "Search Wikipedia for the Treaty of Westphalia"
   ```

### What success looks like

Same as Layer 3a — Claude uses the tool and returns Wikipedia information. But now it's running natively on Windows, not through WSL2.

### What failure looks like

- Build fails on Windows → you have cross-platform code issues (path separators, etc.)
- Server crashes on startup → check for Linux-specific code
- Tool works but file operations fail → check for hardcoded paths

### Common fixes for cross-platform issues

| Problem | Fix |
|---------|-----|
| Hardcoded `/` in paths | Use `path.join()` instead |
| Hardcoded `~` for home | Use `os.homedir()` instead |
| Using `npx` in config | Use `npx.cmd` on Windows |
| Linux-only commands | Use cross-platform npm packages |

### You're done when

The tool works in Cowork on native Windows. This means your code is truly cross-platform and ready to ship to Windows users.

---

## Quick Reference: Commands

| What | Command |
|------|---------|
| Build server | `cd mcp-server && npm run build` |
| Run Inspector | `npx @modelcontextprotocol/inspector node build/index.js` |
| Check WSL distro name | `wsl.exe -l` (in PowerShell) |
| Claude Desktop config | `%APPDATA%\Claude\claude_desktop_config.json` |
| Claude Desktop logs | `%APPDATA%\Claude\logs\` |
| Reconnect in Claude Code | `/mcp` |

---

## Summary: What Each Layer Catches

| Layer | What it tests | Bugs it catches |
|-------|---------------|-----------------|
| 1 - Inspector | Schema + basic function | Protocol errors, schema typos |
| 2 - Claude Code | LLM understanding | Bad descriptions, confusing params |
| 3a - Cowork WSL2 | Full path (dev) | Integration bugs, WSL2 bridge issues |
| 3b - Cowork Native | Full path (user) | Cross-platform bugs, Windows-specific issues |

**Don't skip layers.** Each one catches bugs the others miss.
