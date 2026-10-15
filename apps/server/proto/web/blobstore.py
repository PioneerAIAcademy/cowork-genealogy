"""The web tier's S3 client: the engine's ``GENEALOGY_S3_*`` semantics (``readPgS3Env`` in
``packages/engine/mcp-server/src/store/pg-s3-env.ts``), in botocore.

- ``GENEALOGY_S3_BUCKET`` is required for a client: unset means no client (``None``), never
  a ``"projects"`` default -- a route that needs one answers 503.
- ``GENEALOGY_S3_ENDPOINT`` is optional; unset means AWS. Set, it is path style (MinIO on
  compose DNS has no virtual-hosted names).
- ``GENEALOGY_S3_ACCESS_KEY`` + ``GENEALOGY_S3_SECRET_KEY``: both, static keys; neither,
  botocore's default chain (the instance role on Beanstalk) -- never an empty ``""`` pair,
  which botocore would sign with and S3 would refuse. One alone raises ``S3ConfigError``,
  which the lifespan turns into a refusal to start, as U7 does for a half SQS pair.
- ``GENEALOGY_S3_REGION`` defaults to ``us-east-1``.

The feedback routes use it today (``web/feedback.py``); the sidecar, image and upload
routes (#3262) are meant to use the same client.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

BUCKET_VAR = "GENEALOGY_S3_BUCKET"
ENDPOINT_VAR = "GENEALOGY_S3_ENDPOINT"
ACCESS_KEY_VAR = "GENEALOGY_S3_ACCESS_KEY"
SECRET_KEY_VAR = "GENEALOGY_S3_SECRET_KEY"
REGION_VAR = "GENEALOGY_S3_REGION"
DEFAULT_REGION = "us-east-1"


class S3ConfigError(RuntimeError):
    """A half-configured key pair. Falling back to the default chain would hide it."""


def _get(env: Mapping[str, str], name: str) -> str:
    return (env.get(name) or "").strip()


def _keys(env: Mapping[str, str]) -> tuple[str, str] | None:
    access, secret = _get(env, ACCESS_KEY_VAR), _get(env, SECRET_KEY_VAR)
    if bool(access) != bool(secret):
        missing, present = (SECRET_KEY_VAR, ACCESS_KEY_VAR) if access else (ACCESS_KEY_VAR, SECRET_KEY_VAR)
        raise S3ConfigError(
            f"{present} is set but {missing} is not: set both for static keys, or neither "
            "for the default AWS credential chain"
        )
    return (access, secret) if access else None


def bucket(env: Mapping[str, str]) -> str | None:
    """The configured bucket, or None."""
    return _get(env, BUCKET_VAR) or None


def region(env: Mapping[str, str]) -> str:
    return _get(env, REGION_VAR) or DEFAULT_REGION


def client(env: Mapping[str, str]) -> Any | None:
    """A botocore S3 client, or None when no bucket is configured. Raises
    ``S3ConfigError`` on a half key pair, bucket or not."""
    keys = _keys(env)
    if bucket(env) is None:
        return None
    import botocore.config
    import botocore.session

    session = botocore.session.Session()
    # IMDS pinned to one 1 s attempt, as proto/enqueue.py does for SQS.
    session.set_config_variable("metadata_service_timeout", 1)
    session.set_config_variable("metadata_service_num_attempts", 1)
    endpoint = _get(env, ENDPOINT_VAR) or None
    kwargs: dict[str, Any] = {
        "region_name": region(env),
        "config": botocore.config.Config(
            s3={"addressing_style": "path"} if endpoint else {},
            retries={"max_attempts": 3, "mode": "standard"},
            connect_timeout=5,
            read_timeout=30,
        ),
    }
    if endpoint:
        kwargs["endpoint_url"] = endpoint
    if keys is not None:
        kwargs["aws_access_key_id"], kwargs["aws_secret_access_key"] = keys
    return session.create_client("s3", **kwargs)


def describe(env: Mapping[str, str]) -> str:
    """The start line's S3 half. Names no key."""
    name = bucket(env)
    if name is None:
        return f"s3: no bucket ({BUCKET_VAR} unset)"
    creds = "static keys" if _keys(env) else "default chain"
    where = _get(env, ENDPOINT_VAR) or "aws"
    return f"s3: bucket {name}; endpoint {where}; region {region(env)}; s3 credentials: {creds}"


class S3Blobs:
    """The two calls the web tier makes, on one bucket. Synchronous botocore: callers run
    them under ``asyncio.to_thread``."""

    def __init__(self, s3: Any, bucket_name: str) -> None:
        self.s3 = s3
        self.bucket = bucket_name

    def get(self, key: str) -> bytes:
        resp = self.s3.get_object(Bucket=self.bucket, Key=key)
        body = resp["Body"]
        try:
            return body.read()
        finally:
            body.close()

    def put(self, key: str, data: bytes, content_type: str) -> None:
        self.s3.put_object(Bucket=self.bucket, Key=key, Body=data, ContentType=content_type)


def from_env(env: Mapping[str, str]) -> S3Blobs | None:
    """``S3Blobs`` on the configured bucket, or None with no bucket. Raises
    ``S3ConfigError`` on a half key pair."""
    s3 = client(env)
    name = bucket(env)
    return S3Blobs(s3, name) if s3 is not None and name is not None else None
