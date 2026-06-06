"""E2BProvider — the hosted provider (per-user Firecracker microVM).

Scaffolded but not wired for the POC (no E2B account provisioned yet). The
method mapping below is the verified SDK surface from
docs/plan/sandbox-provider-interface.md §5; fill in the bodies once an
E2B_API_KEY + the genealogy sandbox template image exist.

    create     AsyncSandbox.create(template, envs, metadata, allow_internet_access=True)
    get/resume AsyncSandbox.connect(id)            # auto-resumes if paused
    suspend    sandbox.pause()
    delete     sandbox.kill()
    list       AsyncSandbox.list(SandboxQuery(metadata=...))
    exec       sandbox.commands.run(cmd, envs, cwd, timeout)
    start_proc sandbox.commands.run(cmd, background=True, ...) -> CommandHandle
    expose     sandbox.get_host(port) -> https://{host}
    fs         files.read / files.write / files.list(path, depth)
    watch      files.watch_dir("/project", on_event)   # the viewer path
"""
from __future__ import annotations

from .base import SandboxProvider, SandboxSpec


class E2BProvider(SandboxProvider):
    def __init__(self, api_key: str | None, template: str):
        if not api_key:
            raise RuntimeError(
                "SANDBOX_PROVIDER=e2b but E2B_API_KEY is not set. Provision an "
                "E2B account, build the genealogy sandbox template, and set "
                "E2B_API_KEY. Until then use SANDBOX_PROVIDER=local."
            )
        self._api_key = api_key
        self._template = template
        raise NotImplementedError(
            "E2BProvider is scaffolded but not implemented for the POC. See the "
            "module docstring for the verified SDK mapping. The LocalProvider "
            "exercises the same control-plane code paths in the meantime."
        )

    async def create(self, spec: SandboxSpec):  # pragma: no cover - stub
        raise NotImplementedError

    async def get(self, sandbox_id: str):  # pragma: no cover - stub
        raise NotImplementedError

    async def resume(self, sandbox_id: str):  # pragma: no cover - stub
        raise NotImplementedError

    async def suspend(self, sandbox_id: str) -> None:  # pragma: no cover - stub
        raise NotImplementedError

    async def delete(self, sandbox_id: str) -> None:  # pragma: no cover - stub
        raise NotImplementedError

    async def list(self, labels: dict[str, str] | None = None):  # pragma: no cover - stub
        raise NotImplementedError
