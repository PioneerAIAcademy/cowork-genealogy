"""Does `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` actually stop the hosted agent
writing a memory file outside the project? (issue #4778)

WHY THIS EXISTS

`test_auto_memory_off.py` proves the CLI offers no memory block. This probe
proves no memory file lands.

WHY `"0"` IS THE CONTROL, NOT "unset"

From the bundled CLI (2.1.308):

    function Nm(){ ... let e=process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY;
      if(Fe(e))return"off"; if(ds(e))return"forced_on"; return Um()?"off":"unset" }
    function Z8(){switch(Nm()){case"off":return!1;case"forced_on":return!0;
      case"unset":break} if(swt())return!1; return JO()}

`Fe` is truthy (`1/true/yes/on`), `ds` falsy (`0/false/no/off`). So `"1"` is OFF
and `"0"` is `forced_on`, which returns before `swt()` and the
`autoMemoryEnabled` setting -- a stronger control than leaving the variable
unset, and it exercises the polarity live instead of asserting it.

WHAT A PASS DOES NOT PROVE

Cowork's loader is not this one, and its memory behaviour is out of scope for
#4778. A clean treatment arm with an EMPTY control arm proves nothing at all:
the model has to choose to persist a memory, and `Tp()`'s `G3()` plus `Ga()`'s
four further guards can each suppress the write on their own. That case is
reported VOID, not PASS.

SAFETY

The control arm deliberately forces auto-memory ON, so both arms run with HOME
and CLAUDE_CONFIG_DIR redirected into a temp dir. The operator's own config dir
-- `$CLAUDE_CONFIG_DIR` when set, else `~/.claude` -- is listed before and after
and the probe fails loudly if it changed. Reading `~/.claude` unconditionally
made that check unable to fire at all for anyone who relocates it.

Costs two short sessions. Needs a compiled engine (`make engine-build`) and a
key in $ANTHROPIC_API_KEY or eval/.env. Run it with `make probe-auto-memory`.
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
import tempfile
from pathlib import Path

# From this file, not the cwd: `python apps/server/dev/probe_auto_memory.py`
# run from anywhere should work, and __file__ already says where the checkout is.
_HERE = Path(__file__).resolve()
for parent in _HERE.parents:
    if (parent / "apps" / "server" / "app" / "agent" / "real_agent.py").exists():
        REPO = parent
        break
else:
    sys.exit(f"{_HERE} is not inside a cowork-genealogy checkout")

SERVER_DIR = REPO / "apps" / "server"
ENGINE_BUILD = REPO / "packages" / "engine" / "mcp-server" / "build" / "index.js"
sys.path.insert(0, str(SERVER_DIR))

VAR = "CLAUDE_CODE_DISABLE_AUTO_MEMORY"

# Explicit, so an empty control arm means the variable worked rather than that
# the model declined to persist anything (the VOID case above).
QUERY = (
    "Remember this for all future sessions, as a durable preference: when a "
    "record search times out, give me the search links so I can run them "
    "myself. Save it to your memory now, then reply with one word: SAVED."
)


def api_key() -> str:
    key = os.environ.get("ANTHROPIC_API_KEY", "").strip().strip("\"'")
    if key:
        return key
    env = REPO / "eval" / ".env"
    if env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            if line.startswith("ANTHROPIC_API_KEY="):
                return line.split("=", 1)[1].strip().strip("\"'")
    return ""


def memory_files(config_dir: Path) -> list[str]:
    """Files the CLI's auto-memory writes: `<config>/projects/<slug>/memory/**`.

    Narrow on purpose. Matching any path containing "memory" also matched a file
    the MODEL wrote itself -- the treatment arm still asks it to "save this to
    your memory", and under bypassPermissions it holds Write -- which would read
    as the variable failing. It can still choose this exact path, so a FAIL is
    read, not trusted; it is loud (exit 1, naming the files) rather than silent.
    """
    root = config_dir / "projects"
    if not root.exists():
        return []
    return sorted(
        str(p.relative_to(config_dir))
        for p in root.rglob("*")
        if p.is_file() and "memory" in p.relative_to(root).parts
    )


def operator_config_dir() -> Path:
    """The operator's OWN config dir -- `$CLAUDE_CONFIG_DIR`, else `~/.claude`.

    Reading `~/.claude` unconditionally made the safety check below unable to
    fire for anyone who relocates it: the path does not exist, memory_files()
    returns [], and before == after on every run whatever the probe wrote.
    """
    env = os.environ.get("CLAUDE_CONFIG_DIR", "").strip()
    return Path(env).expanduser() if env else Path.home() / ".claude"


def real_home_fingerprint() -> list[str]:
    """The operator's OWN memory files, so the probe can prove it wrote none."""
    return memory_files(operator_config_dir())


async def run_arm(value: str, key: str) -> dict:
    from claude_agent_sdk import ClaudeSDKClient, ResultMessage
    from app.agent import real_agent

    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        home = tmp / "home"
        home.mkdir()
        project = tmp / "project"
        project.mkdir()
        (project / "research.json").write_text(
            '{"project": {"id": "rp_probe"}}', encoding="utf-8"
        )

        real_agent._MCP_BUILD = str(ENGINE_BUILD)
        options = real_agent.build_options(project, api_key=key)
        # Mutate only the returned object, as probe_hook_binding.py does: no
        # parameter is added to build_options for this probe's benefit.
        options.env[VAR] = value
        # Both, and before the run: CLAUDE_CONFIG_DIR defaults to $HOME/.claude,
        # and the control arm forces memory ON. Pinning only one of them leaves
        # a path to the operator's real directory.
        options.env["HOME"] = str(home)
        options.env["CLAUDE_CONFIG_DIR"] = str(home / ".claude")

        reply: list[str] = []
        client = ClaudeSDKClient(options=options)
        await client.connect()
        try:
            await client.query(QUERY)
            async for msg in client.receive_response():
                for block in getattr(msg, "content", []) or []:
                    if getattr(block, "text", None):
                        reply.append(block.text)
                if isinstance(msg, ResultMessage):
                    break
        finally:
            await client.disconnect()

        return {
            "value": value,
            "home": str(home),
            "memory_files": memory_files(home / ".claude"),
            "reply": " ".join(reply)[:400],
        }


# build_options sets no max_turns, so a model that loops on tool calls under
# bypassPermissions would bill until someone noticed. probe_agent_binding.py
# bounds its arms the same way.
ARM_TIMEOUT_S = 300


async def bounded_arm(value: str, key: str) -> dict:
    try:
        return await asyncio.wait_for(run_arm(value, key), timeout=ARM_TIMEOUT_S)
    except asyncio.TimeoutError:
        sys.exit(
            f"arm {VAR}={value} ran past {ARM_TIMEOUT_S}s and was cut off. "
            "Nothing is proven; re-run, and if it recurs the session is looping."
        )


async def main() -> None:
    key = api_key()
    if not key:
        sys.exit("no key: set ANTHROPIC_API_KEY or put one in eval/.env")
    if not ENGINE_BUILD.exists():
        sys.exit(f"no compiled engine at {ENGINE_BUILD} -- run `make engine-build`")

    before = real_home_fingerprint()

    print(f"\n=== control arm: {VAR}=0 (forced_on) -- MUST write a memory file ===")
    control = await bounded_arm("0", key)
    for f in control["memory_files"]:
        print(f"  wrote {f}")
    print(f"  files: {len(control['memory_files'])}  reply: {control['reply'][:120]}")

    print(f"\n=== treatment arm: {VAR}=1 (off) -- MUST write nothing ===")
    treatment = await bounded_arm("1", key)
    for f in treatment["memory_files"]:
        print(f"  wrote {f}")
    print(f"  files: {len(treatment['memory_files'])}  reply: {treatment['reply'][:120]}")

    after = real_home_fingerprint()
    print("\n=== verdict ===")
    if before != after:
        added = sorted(set(after) - set(before))
        print(f"FAIL: the probe wrote into the operator's OWN ~/.claude: {added}")
        print("The HOME redirect did not hold. Delete those files.")
        sys.exit(3)

    if not control["memory_files"]:
        print("VOID: the control arm wrote no memory file, so this run proves")
        print("nothing -- an empty treatment arm is indistinguishable from a")
        print("working fix. Re-run; if it stays empty, do not report either arm")
        print("as evidence (Tp()'s G3() and Ga()'s further guards can each")
        print("suppress the write on their own).")
        sys.exit(2)

    if treatment["memory_files"]:
        print(f"FAIL: {VAR}=1 still wrote {treatment['memory_files']}")
        sys.exit(1)

    print(f"PASS: {VAR}=0 wrote {len(control['memory_files'])} memory file(s);")
    print(f"      {VAR}=1 wrote none. The variable is honoured on CLI 2.1.308.")
    print(json.dumps({"control": control, "treatment": treatment}, indent=2)[:1200])


if __name__ == "__main__":
    asyncio.run(main())
