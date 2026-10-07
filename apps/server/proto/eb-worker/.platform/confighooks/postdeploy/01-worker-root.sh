#!/bin/bash
# Re-asserts predeploy's (f): web.service runs as root, so the worker can launch each turn's
# CLI as its slot user. A configuration-only update rewrites web.service and its drop-in is
# gone afterwards, and such an update runs no .platform/hooks/, so the worker came back as
# webapp and refused to start at step=turn_users (U13, 2026-10-07). This file is copied
# identically to .platform/confighooks/postdeploy/ so it runs after both kinds of deploy.
# It restarts the worker only when it is not already root.
set -euo pipefail

DROPIN_DIR=/etc/systemd/system/web.service.d
install -d -m 0755 -o root -g root "$DROPIN_DIR"
printf '[Service]\nUser=root\nGroup=root\n' > "$DROPIN_DIR/10-genealogy-root.conf"
if [ -d /run/systemd/system ]; then
  systemctl daemon-reload
  # The running process, not the unit: after the reload `systemctl show -p User` already says
  # root. MainPID 0 is a crash-looping worker, which Restart=always starts as root anyway.
  pid="$(systemctl show -p MainPID --value web.service)"
  if [ "${pid:-0}" != "0" ] && [ "$(ps -o user= -p "$pid" | tr -d ' ')" != "root" ]; then
    systemctl restart web.service
  fi
fi
