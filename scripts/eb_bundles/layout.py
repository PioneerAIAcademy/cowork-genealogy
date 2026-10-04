"""The Beanstalk bundle layout (U12, docs/plan/familysearch-handoff.md): the constants
the builder, the tier templates and their tests agree on. Constants only, stdlib only.

scripts/eb_bundles/verify.py deliberately does NOT import this module: it states its
own copy of each value, so a builder or template that drifts from the verifier is
caught rather than agreed with.
"""
from __future__ import annotations

TIERS = ("web", "worker", "tools")

# Beanstalk's AppDeployDir on the AL2023 platforms (unmeasured on the target account;
# U13 confirms it with `get-config platformconfig`).
APP_DIR = "/var/app/current"

# The RDS CA bundle, shipped in every tier, and the absolute path its template names.
CA_PATH_IN_BUNDLE = "certs/rds-global-bundle.pem"
CA_PATH_ON_INSTANCE = f"{APP_DIR}/{CA_PATH_IN_BUNDLE}"
RDS_CA_URL = "https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem"
# The variable each tier's template points at CA_PATH_ON_INSTANCE: libpq reads
# PGSSLROOTCERT, Node's TLS stack reads NODE_EXTRA_CA_CERTS.
CA_ENV_VAR = {"web": "PGSSLROOTCERT", "worker": "PGSSLROOTCERT", "tools": "NODE_EXTRA_CA_CERTS"}

# Each tier's `PORT` (.ebextensions). Web and tools Procfiles carry the same literal as
# --port; the worker's Procfile takes no arguments (worker.py reads PORT).
PORTS = {"web": 8000, "worker": 8000, "tools": 8080}

# AWS documents 500 MB; checked as bytes of zip, the stricter of MB and MiB.
SIZE_LIMIT_BYTES = 500_000_000

# Wheel architectures; pip picks the matching tag from one wheels/ directory.
ARCHES = ("x86_64", "aarch64")
PYTHON_VERSION = "3.12"

# The worker's predeploy hook moves ./plugin here; the template's ENGINE_PLUGIN_DIR.
PLUGIN_DEST = "/opt/genealogy/plugin"
WORKER_CWD = "/project"
TMPDIR = "/tmp"

# The SPA's directory at the web tier root; the template's WEB_DIST_DIR.
WEB_DIST_DIR = "web-dist"

# Repo-relative sources.
TEMPLATE_DIRS = {tier: f"apps/server/proto/eb-{tier}" for tier in TIERS}
REQUIREMENTS = {
    "web": "apps/server/proto/web/requirements.txt",
    "worker": "apps/server/proto/worker/requirements.txt",
}
ENGINE_DIR = "packages/engine/mcp-server"
PLUGIN_DIR = "packages/engine/plugin"

# Bundle-relative names.
REQUIREMENTS_IN_BUNDLE = "requirements.txt"
REQUIREMENTS_HEADER = "--no-index\n--find-links wheels\n"
WHEELS_DIR = "wheels"
BUILD_INFO_IN_BUNDLE = "BUILD-INFO.json"
PLUGIN_IN_BUNDLE = "plugin"
SMOKE_IN_BUNDLE = "smoke"

# Outputs, under --out (default releases/).
BUNDLE_NAMES = {tier: f"eb-{tier}.zip" for tier in TIERS}
MANIFEST_NAME = "eb-bundles.json"
