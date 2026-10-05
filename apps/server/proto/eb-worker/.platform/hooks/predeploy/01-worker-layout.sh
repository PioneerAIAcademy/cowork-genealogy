#!/bin/bash
# The worker tier's on-instance layout (U12 D25/D26), run by Beanstalk as root after the
# build steps and before the Procfile starts; idempotent, so a redeploy or a re-run of
# the hook on the same staging directory is safe. Any failure fails the deploy.
#
#   (a) ./plugin -> /opt/genealogy/plugin, root:root, dirs 0755 / files 0644, built
#       beside the live copy and renamed into place, then removed from staging, so the
#       agent (webapp) can never write the skills or hooks another patron's turn loads;
#   (b) /project, the CLI's cwd anchor: root-owned 0555, and empty;
#   (c) /tmp must be a tmpfs (TMPDIR, "writable, never persistent");
#   (d) the staging app directory root-owned and not group/other-writable.
set -euo pipefail

PLUGIN_DEST=/opt/genealogy/plugin
PROJECT_DIR=/project

fail() {
  echo "01-worker-layout: $*" >&2
  exit 1
}

staging=""
if [ -x /opt/elasticbeanstalk/bin/get-config ]; then
  staging="$(/opt/elasticbeanstalk/bin/get-config platformconfig -k AppStagingDir 2>/dev/null || true)"
fi
staging="${staging:-$PWD}"
# Guards (d)'s recursive chown against a wrong directory.
[ -f "$staging/proto/worker/worker.py" ] || fail "$staging is not the worker bundle"

# (a)
rm -rf "$PLUGIN_DEST.new" "$PLUGIN_DEST.old"
if [ -d "$staging/plugin" ]; then
  install -d -m 0755 -o root -g root "$(dirname "$PLUGIN_DEST")"
  cp -R "$staging/plugin" "$PLUGIN_DEST.new"
  chown -R root:root "$PLUGIN_DEST.new"
  # Dirs 0755, files 0644 with coreutils alone (no findutils on a bare AL2023): clear
  # every x, then X restores it on directories only.
  chmod -R a-x "$PLUGIN_DEST.new"
  chmod -R u=rwX,go=rX "$PLUGIN_DEST.new"
  if [ -e "$PLUGIN_DEST" ]; then
    mv "$PLUGIN_DEST" "$PLUGIN_DEST.old"
  fi
  mv "$PLUGIN_DEST.new" "$PLUGIN_DEST"
  rm -rf "$PLUGIN_DEST.old" "$staging/plugin"
elif [ ! -d "$PLUGIN_DEST" ]; then
  fail "no plugin/ in the bundle and none at $PLUGIN_DEST"
fi

# (b)
if [ -e "$PROJECT_DIR" ] && [ ! -d "$PROJECT_DIR" ]; then
  fail "$PROJECT_DIR exists and is not a directory"
fi
if [ -d "$PROJECT_DIR" ] && [ -n "$(ls -A "$PROJECT_DIR")" ]; then
  fail "$PROJECT_DIR is not empty"
fi
install -d -m 0555 -o root -g root "$PROJECT_DIR"

# (c)
tmp_fstype="$(findmnt -n -o FSTYPE /tmp || true)"
[ "$tmp_fstype" = "tmpfs" ] || fail "/tmp is not a tmpfs (${tmp_fstype:-not a mount point})"

# (d) a+rX keeps every file readable to webapp once root owns it.
chown -R root:root "$staging"
chmod -R go-w,a+rX "$staging"
