"""Offline tests for U13's rehearsal tool, ``apps/server/proto/eb-rehearsal/rehearse.py``.

A fake ``aws`` runner stands in for the CLI: no network, no AWS. Plan: the U13 PR3 section
(provisioner, teardown, probes, leak check). What is pinned:

- the account guard (expected account, us-east-1, ``--billed``) refuses before any other call;
- every create is tagged and named ``genealogy-u13-*``, IAM under ``/genealogy-u13/``;
- no secret value in any argv, dry-run line or non-secret file; option settings and secret
  strings only as 0600 ``file://`` paths under the work dir;
- tier security groups and instance profiles through the launch configuration, the tools ALB
  internal and application, web first boot without sign-in settings, RDS private, the
  bucket's public-access block;
- both namespaces of ``01-sqsd.config`` at API level on the worker, and every sqsd option
  with a mirror set together with it, in ``up`` and in every probe case;
- dev-only variables only from a probe case; restores by snapshot or ``--options-to-remove``,
  in ``finally``;
- the migrate policy's two ARNs and its removal on failure;
- kinds created by ``up`` = kinds deleted by ``down`` = kinds checked by ``prove-empty``;
- the D9 leak check and the 12-digit scan.
"""

from __future__ import annotations

import importlib.util
import json
import re
import shlex
import stat
import subprocess
from pathlib import Path

import pytest
import yaml

REPO = Path(__file__).resolve().parents[3]
REHEARSAL_DIR = REPO / "apps" / "server" / "proto" / "eb-rehearsal"
TESTS = Path(__file__).resolve().parent
ACCOUNT = "000000000000"
MASTER_ARN = f"arn:aws:secretsmanager:us-east-1:{ACCOUNT}:secret:rds!db-fake-AbCdEf"
FAKE_MODEL_KEY = "sk-ant-u13-fake-model-key-value"


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


rh = _load("u13_rehearse", REHEARSAL_DIR / "rehearse.py")
bundles_test = _load("u13_bundles_test", TESTS / "test_proto_bundles.py")


# ── the fake aws ──────────────────────────────────────────────────────────────────────


class AwsError(Exception):
    pass


def _flag(rest: list[str], name: str, default=None):
    return rest[rest.index(name) + 1] if name in rest else default


def _flag_values(rest: list[str], name: str) -> list[str]:
    if name not in rest:
        return []
    out = []
    for item in rest[rest.index(name) + 1:]:
        if item.startswith("--"):
            break
        out.append(item)
    return out


class FakeAws:
    """A stateful stand-in for the aws CLI: creates add to ``self.have``, deletes remove."""

    def __init__(self):
        self.calls: list[list[str]] = []
        self.call_files: list[dict[str, str]] = []
        self.files: dict[str, str] = {}
        self.have: dict[str, dict] = {}
        self.fail: dict[str, str] = {}
        self.leftover: dict[str, object] = {}
        self.ssm_status = "Success"
        self.env_settings: dict[str, dict] = {}

    # plumbing

    def __call__(self, argv: list[str]):
        self.calls.append(list(argv))
        snap = {a: Path(a[len("file://"):]).read_text(encoding="utf-8") for a in argv if a.startswith("file://")}
        self.call_files.append(snap)
        self.files.update(snap)
        i = argv.index("--output") + 2
        svc, op, rest = argv[i], argv[i + 1], argv[i + 2:]
        key = f"{svc} {op}"
        if key in self.fail:
            return subprocess.CompletedProcess(argv, 254, "", self.fail[key])
        handler = getattr(self, f"{svc}_{op}".replace("-", "_"), None)
        try:
            body = handler(rest) if handler else {}
        except AwsError as exc:
            return subprocess.CompletedProcess(argv, 254, "", str(exc))
        return subprocess.CompletedProcess(argv, 0, body if isinstance(body, str) else json.dumps(body), "")

    def reset(self) -> None:
        self.calls.clear()
        self.call_files.clear()

    def ops(self) -> list[tuple[str, str]]:
        out = []
        for argv in self.calls:
            i = argv.index("--output") + 2
            out.append((argv[i], argv[i + 1]))
        return out

    def calls_to(self, svc: str, op: str) -> list[list[str]]:
        return [a for a in self.calls if a[a.index("--output") + 2: a.index("--output") + 4] == [svc, op]]

    def file_of(self, argv: list[str], flag: str):
        """The file a call named, as it was when that call ran."""
        i = next(n for n, a in enumerate(self.calls) if a is argv)
        return json.loads(self.call_files[i][argv[argv.index(flag) + 1]])

    def add(self, kind: str, name: str, **data) -> dict:
        self.have[f"{kind}:{name}"] = {"name": name, **data}
        return self.have[f"{kind}:{name}"]

    def get(self, kind: str, name: str):
        return self.have.get(f"{kind}:{name}")

    def drop(self, kind: str, name: str) -> None:
        self.have.pop(f"{kind}:{name}", None)

    def all(self, kind: str) -> list[dict]:
        return [v for k, v in self.have.items() if k.startswith(kind + ":")]

    # sts, ce, budgets

    def sts_get_caller_identity(self, rest):
        return {"Account": ACCOUNT, "Arn": "arn:aws:sts::<account>:assumed-role/x/y"}

    def ce_get_cost_and_usage(self, rest):
        return {"ResultsByTime": [{"TimePeriod": {"Start": f"2026-09-{d:02d}"}, "Total": {
            "UnblendedCost": {"Amount": str(d / 10), "Unit": "USD"}}} for d in range(1, 4)]}

    def budgets_describe_budget(self, rest):
        if not self.get("budget", rh.BUDGET_NAME) and "budget" not in self.leftover:
            raise AwsError("An error occurred (NotFoundException) when calling DescribeBudget")
        return {"Budget": {"CalculatedSpend": {"ActualSpend": {"Amount": "1.0", "Unit": "USD"}}}}

    def budgets_create_budget(self, rest):
        self.add("budget", rh.BUDGET_NAME)

    def budgets_delete_budget(self, rest):
        self.drop("budget", rh.BUDGET_NAME)

    # iam

    def iam_get_role(self, rest):
        if not self.get("role", _flag(rest, "--role-name")):
            raise AwsError("An error occurred (NoSuchEntity) when calling GetRole")
        return {"Role": {}}

    def iam_create_role(self, rest):
        self.add("role", _flag(rest, "--role-name"))

    def iam_get_instance_profile(self, rest):
        got = self.get("profile", _flag(rest, "--instance-profile-name"))
        if not got:
            raise AwsError("An error occurred (NoSuchEntity) when calling GetInstanceProfile")
        return {"InstanceProfile": {"Roles": got.get("roles", [])}}

    def iam_create_instance_profile(self, rest):
        self.add("profile", _flag(rest, "--instance-profile-name"), roles=[])

    def iam_add_role_to_instance_profile(self, rest):
        self.get("profile", _flag(rest, "--instance-profile-name"))["roles"] = [
            {"RoleName": _flag(rest, "--role-name")}]

    def iam_list_instance_profiles(self, rest):
        return {"InstanceProfiles": [{"InstanceProfileName": p["name"], "Roles": p.get("roles", [])}
                                     for p in self.all("profile")]}

    def iam_delete_instance_profile(self, rest):
        self.drop("profile", _flag(rest, "--instance-profile-name"))

    def iam_list_roles(self, rest):
        return {"Roles": [{"RoleName": r["name"]} for r in self.all("role")]}

    def iam_list_attached_role_policies(self, rest):
        return {"AttachedPolicies": [{"PolicyArn": "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"}]}

    def iam_list_role_policies(self, rest):
        return {"PolicyNames": [_flag(rest, "--role-name")]}

    def iam_delete_role(self, rest):
        self.drop("role", _flag(rest, "--role-name"))

    # ec2, ssm

    def ec2_describe_vpcs(self, rest):
        return {"Vpcs": [{"VpcId": "vpc-fake"}]}

    def ec2_describe_subnets(self, rest):
        return {"Subnets": [{"SubnetId": "subnet-b"}, {"SubnetId": "subnet-a"}]}

    def ec2_describe_security_groups(self, rest):
        if "--group-ids" in rest:
            gid = _flag(rest, "--group-ids")
            if not any(g["id"] == gid for g in self.all("sg")):
                raise AwsError("An error occurred (InvalidGroup.NotFound)")
            return {"SecurityGroups": [{"GroupId": gid}]}
        names = [f.split("Values=", 1)[1] for f in _flag_values(rest, "--filters") if f.startswith("Name=group-name")]
        pattern = names[0] if names else "*"
        groups = [g for g in self.all("sg") if re.fullmatch(pattern.replace("*", ".*"), g["name"])]
        return {"SecurityGroups": [{"GroupName": g["name"], "GroupId": g["id"]} for g in groups]}

    def ec2_create_security_group(self, rest):
        name = _flag(rest, "--group-name")
        self.add("sg", name, id=f"sg-{name.rsplit('u13-', 1)[1]}")
        return {"GroupId": f"sg-{name.rsplit('u13-', 1)[1]}"}

    def ec2_delete_security_group(self, rest):
        gid = _flag(rest, "--group-id")
        for g in self.all("sg"):
            if g["id"] == gid:
                self.drop("sg", g["name"])

    def ec2_describe_instances(self, rest):
        return {"Reservations": [{"Instances": [{"InstanceId": i["name"]} for i in self.all("instance")]}]}

    def ec2_run_instances(self, rest):
        self.add("instance", "i-bastion")
        return {"Instances": [{"InstanceId": "i-bastion"}]}

    def ec2_terminate_instances(self, rest):
        for i in _flag_values(rest, "--instance-ids"):
            self.drop("instance", i)

    def ec2_describe_addresses(self, rest):
        return {"Addresses": self.leftover.get("eip", [])}

    def ssm_get_parameter(self, rest):
        return {"Parameter": {"Value": "ami-fake"}}

    def ssm_send_command(self, rest):
        return {"Command": {"CommandId": "cmd-fake"}}

    def ssm_get_command_invocation(self, rest):
        return {"Status": self.ssm_status, "StandardOutputContent": "migrate: ok", "StandardErrorContent": "boom"}

    # rds

    def _rds(self, kind, rest, flag, error):
        if not self.get(kind, _flag(rest, flag)):
            raise AwsError(f"An error occurred ({error})")

    def rds_describe_db_subnet_groups(self, rest):
        self._rds("subnet-group", rest, "--db-subnet-group-name", "DBSubnetGroupNotFoundFault")
        return {}

    def rds_create_db_subnet_group(self, rest):
        self.add("subnet-group", _flag(rest, "--db-subnet-group-name"))

    def rds_delete_db_subnet_group(self, rest):
        self.drop("subnet-group", _flag(rest, "--db-subnet-group-name"))

    def rds_describe_db_parameter_groups(self, rest):
        self._rds("param-group", rest, "--db-parameter-group-name", "DBParameterGroupNotFound")
        return {}

    def rds_create_db_parameter_group(self, rest):
        self.add("param-group", _flag(rest, "--db-parameter-group-name"))

    def rds_delete_db_parameter_group(self, rest):
        self.drop("param-group", _flag(rest, "--db-parameter-group-name"))

    def rds_describe_db_instances(self, rest):
        self._rds("db", rest, "--db-instance-identifier", "DBInstanceNotFound")
        return {"DBInstances": [{"Endpoint": {"Address": "pg.rds.invalid"},
                                 "MasterUserSecret": {"SecretArn": MASTER_ARN},
                                 "DBParameterGroups": [{"ParameterApplyStatus": "in-sync"}]}]}

    def rds_create_db_instance(self, rest):
        self.add("db", _flag(rest, "--db-instance-identifier"))

    def rds_delete_db_instance(self, rest):
        self.drop("db", _flag(rest, "--db-instance-identifier"))

    # s3

    def s3api_head_bucket(self, rest):
        bucket = _flag(rest, "--bucket")
        if bucket in self.leftover.get("forbidden_buckets", []):
            raise AwsError("An error occurred (403) when calling the HeadBucket operation: Forbidden")
        if not self.get("bucket", bucket):
            raise AwsError("An error occurred (404) when calling the HeadBucket operation: Not Found")
        return ""

    def s3api_create_bucket(self, rest):
        self.add("bucket", _flag(rest, "--bucket"))

    def s3api_delete_bucket(self, rest):
        self.drop("bucket", _flag(rest, "--bucket"))

    def s3api_list_buckets(self, rest):
        return [b["name"] for b in self.all("bucket") if b["name"].startswith("genealogy-u13-data-")]

    def s3api_list_objects_v2(self, rest):
        return self.leftover.get("storage_keys", [])

    def s3api_get_bucket_versioning(self, rest):
        return {}

    # secrets

    def secretsmanager_describe_secret(self, rest):
        got = self.get("secret", _flag(rest, "--secret-id"))
        if not got:
            raise AwsError("An error occurred (ResourceNotFoundException)")
        return {"ARN": got["arn"]}

    def secretsmanager_create_secret(self, rest):
        name = _flag(rest, "--name")
        return {"ARN": self.add("secret", name, arn=f"arn:aws:secretsmanager:us-east-1:{ACCOUNT}:secret:{name}-AbCdEf")["arn"]}

    def secretsmanager_list_secrets(self, rest):
        return {"SecretList": [{"Name": s["name"]} for s in self.all("secret")]}

    def secretsmanager_delete_secret(self, rest):
        self.drop("secret", _flag(rest, "--secret-id"))

    # beanstalk

    def elasticbeanstalk_list_available_solution_stacks(self, rest):
        return {"SolutionStacks": ["64bit Amazon Linux 2023 v4.13.9 running Python 3.12",
                                   "64bit Amazon Linux 2023 v4.10.0 running Python 3.12",
                                   "64bit Amazon Linux 2023 v6.11.9 running Node.js 24"]}

    def elasticbeanstalk_create_storage_location(self, rest):
        self.add("bucket", f"elasticbeanstalk-us-east-1-{ACCOUNT}")
        return {"S3Bucket": f"elasticbeanstalk-us-east-1-{ACCOUNT}"}

    def elasticbeanstalk_describe_applications(self, rest):
        return {"Applications": [{"ApplicationName": a["name"]} for a in self.all("app")]}

    def elasticbeanstalk_create_application(self, rest):
        self.add("app", _flag(rest, "--application-name"))

    def elasticbeanstalk_delete_application(self, rest):
        self.drop("app", _flag(rest, "--application-name"))

    def elasticbeanstalk_describe_application_versions(self, rest):
        label = _flag(rest, "--version-labels")
        return {"ApplicationVersions": [{"Status": "PROCESSED"}] if self.get("version", label) else []}

    def elasticbeanstalk_create_application_version(self, rest):
        self.add("version", _flag(rest, "--version-label"))

    def elasticbeanstalk_describe_environments(self, rest):
        names = _flag_values(rest, "--environment-names")
        envs = [e for e in self.all("env") if not names or e["name"] in names]
        return {"Environments": [{"EnvironmentName": e["name"], "EnvironmentId": e["id"], "Status": "Ready",
                                  "Health": "Green", "CNAME": f"{e['name']}.invalid"} for e in envs]}

    def _apply(self, name, rest):
        settings = self.env_settings.setdefault(name, {})
        if "--option-settings" in rest:
            for o in json.loads(self.files[_flag(rest, "--option-settings")]):
                settings[(o["Namespace"], o["OptionName"])] = o["Value"]
        if "--options-to-remove" in rest:
            for o in json.loads(self.files[_flag(rest, "--options-to-remove")]):
                settings.pop((o["Namespace"], o["OptionName"]), None)

    def elasticbeanstalk_create_environment(self, rest):
        name = _flag(rest, "--environment-name")
        self.add("env", name, id=f"e-{name.rsplit('-', 1)[1]}")
        self._apply(name, rest)

    def elasticbeanstalk_update_environment(self, rest):
        self._apply(_flag(rest, "--environment-name"), rest)

    def elasticbeanstalk_terminate_environment(self, rest):
        self.drop("env", _flag(rest, "--environment-name"))

    def elasticbeanstalk_describe_environment_resources(self, rest):
        name = _flag(rest, "--environment-name")
        return {"EnvironmentResources": {
            "Queues": [{"Name": "WorkerQueue", "URL": f"https://sqs.us-east-1.amazonaws.com/{ACCOUNT}/q-{name}"}],
            "Instances": [{"Id": f"i-{name}"}],
            "LoadBalancers": [{"Name": f"arn:aws:elasticloadbalancing:us-east-1:{ACCOUNT}:loadbalancer/app/{name}"}]}}

    def elasticbeanstalk_describe_configuration_settings(self, rest):
        settings = self.env_settings.get(_flag(rest, "--environment-name"), {})
        return {"ConfigurationSettings": [{"OptionSettings": [
            {"Namespace": ns, "OptionName": n, "Value": v} for (ns, n), v in settings.items()]}]}

    # resolver, logs, tags, and what prove-empty asks of recorded ids

    def route53resolver_list_resolver_query_log_configs(self, rest):
        return {"ResolverQueryLogConfigs": [{"Id": r["name"]} for r in self.all("resolver")]}

    def route53resolver_create_resolver_query_log_config(self, rest):
        self.add("resolver", "rqlc-fake")
        return {"ResolverQueryLogConfig": {"Id": "rqlc-fake"}}

    def route53resolver_list_resolver_query_log_config_associations(self, rest):
        return {"ResolverQueryLogConfigAssociations": []}

    def route53resolver_delete_resolver_query_log_config(self, rest):
        self.drop("resolver", _flag(rest, "--resolver-query-log-config-id"))

    def logs_create_log_group(self, rest):
        self.add("log", _flag(rest, "--log-group-name"))

    def logs_describe_log_groups(self, rest):
        prefix = _flag(rest, "--log-group-name-prefix")
        return {"logGroups": [{"logGroupName": g["name"]} for g in self.all("log") if g["name"].startswith(prefix)]}

    def logs_delete_log_group(self, rest):
        self.drop("log", _flag(rest, "--log-group-name"))

    def resourcegroupstaggingapi_get_resources(self, rest):
        return {"ResourceTagMappingList": [{"ResourceARN": a} for a in self.leftover.get("tagged", [])]}

    def cloudformation_describe_stacks(self, rest):
        if "stack" in self.leftover:
            return {"Stacks": [{}]}
        raise AwsError("An error occurred (ValidationError): Stack with id x does not exist")

    def elbv2_describe_load_balancers(self, rest):
        raise AwsError("An error occurred (LoadBalancerNotFound)")

    def sqs_get_queue_url(self, rest):
        raise AwsError("An error occurred (AWS.SimpleQueueService.NonExistentQueue)")


# ── helpers ───────────────────────────────────────────────────────────────────────────


@pytest.fixture
def env(tmp_path, monkeypatch):
    """A work dir, a .local dir, a bundles dir holding a manifest, and the model key."""
    work = tmp_path / "work"
    local = tmp_path / "local"
    local.mkdir()
    (local / "alert-email").write_text("ops@example.invalid\n", encoding="utf-8")
    (local / "allowed-emails").write_text("a@example.invalid b@example.invalid\n", encoding="utf-8")
    bundles = tmp_path / "bundles"
    bundles.mkdir()
    manifest = {"git_sha": "abcdef1234567890", "dirty": False, "bundles": {}}
    for tier in rh.TIERS:
        data = f"zip for {tier}".encode()
        (bundles / f"eb-{tier}.zip").write_bytes(data)
        import hashlib
        manifest["bundles"][tier] = {"file": f"eb-{tier}.zip", "sha256": hashlib.sha256(data).hexdigest()}
    (bundles / "eb-bundles.json").write_text(json.dumps(manifest), encoding="utf-8")
    env_file = tmp_path / "eval.env"
    env_file.write_text(f"ANTHROPIC_API_KEY={FAKE_MODEL_KEY}\n", encoding="utf-8")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    return {"work": work, "local": local, "bundles": bundles, "env_file": env_file}


def run(env, fake, *argv, out=None, sleep=lambda s: None):
    lines = out if out is not None else []
    args = list(argv)
    if args[0] not in ("leak-check",):
        args += ["--work-dir", str(env["work"])]
        if "--expect-account" not in args:
            args += ["--expect-account", ACCOUNT]
    rc = rh.main(args, runner=fake, sleep=sleep, out=lines.append, local_dir=env["local"])
    return rc, lines


def up_all(env, fake, *extra):
    return run(env, fake, "up", "--billed", "--phase", "all", "--phase", "signin", "--phase", "resolver",
               "--bundles-dir", str(env["bundles"]), "--env-file", str(env["env_file"]), *extra)


def secret_values(env) -> list[str]:
    values = [FAKE_MODEL_KEY]
    for path in (env["work"] / "secrets").iterdir():
        values.append(path.read_text(encoding="utf-8").strip())
    return values


def options_file(env, name: str) -> dict[tuple[str, str], str]:
    path = env["work"] / "options" / f"{name}.json"
    return {(o["Namespace"], o["OptionName"]): o["Value"] for o in json.loads(path.read_text(encoding="utf-8"))}


def creates(fake) -> list[list[str]]:
    return [a for a in fake.calls if (lambda op: op.startswith("create-") or op == "run-instances")(
        a[a.index("--output") + 3])]


# ── the template subset the tool parses ───────────────────────────────────────────────


@pytest.mark.parametrize("tier", rh.TIERS)
def test_parse_ebextensions_agrees_with_yaml(tier):
    for path in sorted((REPO / rh.layout.TEMPLATE_DIRS[tier] / ".ebextensions").glob("*.config")):
        text = path.read_text(encoding="utf-8")
        expected = {ns: {k: str(v) for k, v in opts.items()}
                    for ns, opts in yaml.safe_load(text)["option_settings"].items()}
        assert rh.parse_ebextensions(text) == expected, path.name


def test_parse_ebextensions_refuses_what_it_cannot_read():
    with pytest.raises(ValueError):
        rh.parse_ebextensions('option_settings:\n  aws:x:\n    Name: unquoted\n')
    with pytest.raises(ValueError):
        rh.parse_ebextensions('option_settings:\n  aws:x:\n    A: "1"\n    A: "2"\n')


def test_tool_copies_of_bundle_test_patterns_agree():
    assert rh.EB_VALUE.pattern == bundles_test.EB_VALUE.pattern
    assert rh.SECRET_NAME.pattern == bundles_test.SECRET_NAME.pattern


def test_dml_tables_are_the_schema_tables():
    tables = set()
    for path in (REPO / "apps" / "server" / "proto" / "sql").glob("*.sql"):
        tables |= {m.lower() for m in re.findall(r"(?i)create table (?:if not exists )?([a-z_]+)",
                                                 path.read_text(encoding="utf-8"))}
    assert set(rh.DML_TABLES) == tables - {"schema_migrations"}


# ── the guard ─────────────────────────────────────────────────────────────────────────


def test_guard_refuses_a_wrong_account_before_any_other_call(env):
    fake = FakeAws()
    rc, _ = run(env, fake, "up", "--billed", "--phase", "iam", "--expect-account", "123456789012")
    assert rc != 0
    assert fake.ops() == [("sts", "get-caller-identity")]


def test_guard_refuses_another_region_and_a_missing_account_with_no_call(env):
    fake = FakeAws()
    rc, _ = run(env, fake, "up", "--billed", "--phase", "iam", "--region", "us-west-2")
    assert rc != 0 and fake.calls == []
    rc = rh.main(["status", "--work-dir", str(env["work"])], runner=fake, out=lambda line: None,
                 local_dir=env["local"])
    assert rc != 0 and fake.calls == [], "no --expect-account and no .local/account"
    (env["local"] / "account").write_text(ACCOUNT + "\n", encoding="utf-8")
    rc = rh.main(["status", "--work-dir", str(env["work"])], runner=fake, out=lambda line: None,
                 local_dir=env["local"])
    assert rc == 0 and fake.ops()[0] == ("sts", "get-caller-identity"), ".local/account is the fallback"


@pytest.mark.parametrize("cmd", [["up", "--phase", "iam"], ["down"], ["probe", "--case", "cap_1usd"]])
def test_billed_commands_need_billed(env, cmd):
    fake = FakeAws()
    rc, _ = run(env, fake, *cmd)
    assert rc != 0 and fake.calls == []


def test_work_dir_inside_the_worktree_is_refused(tmp_path):
    rc = rh.main(["plan", "--expect-account", ACCOUNT, "--work-dir", str(REHEARSAL_DIR / "w")],
                 runner=FakeAws(), out=lambda line: None)
    assert rc == 2
    assert not (REHEARSAL_DIR / "w").exists()


def test_local_dir_is_gitignored():
    res = subprocess.run(["git", "check-ignore", "-q", str(rh.LOCAL_DIR / "account")], cwd=REPO,
                         capture_output=True, text=True, encoding="utf-8", check=False)
    assert res.returncode == 0, f"{rh.LOCAL_DIR} must be gitignored (D9)"


# ── a full up against the fake ────────────────────────────────────────────────────────


@pytest.fixture
def stack(env):
    fake = FakeAws()
    rc, lines = up_all(env, fake)
    assert rc == 0, lines[-5:]
    return env, fake, lines


def test_every_call_is_pinned_to_us_east_1(stack):
    _, fake, _ = stack
    assert all(a[a.index("--region") + 1] == "us-east-1" for a in fake.calls)
    assert fake.ops()[0] == ("sts", "get-caller-identity")


def test_every_create_is_tagged_and_named(stack):
    env, fake, _ = stack
    run_id = json.loads((env["work"] / "inventory.json").read_text(encoding="utf-8"))["run_id"]
    untaggable = {"create-storage-location"}
    tagged_after = {"create-bucket": "put-bucket-tagging"}
    name_flags = ("--role-name", "--instance-profile-name", "--group-name", "--db-instance-identifier",
                  "--db-subnet-group-name", "--db-parameter-group-name", "--name", "--application-name",
                  "--environment-name", "--version-label", "--bucket", "--log-group-name")
    for argv in creates(fake):
        op = argv[argv.index("--output") + 3]
        if op in untaggable:
            continue
        if op in tagged_after:
            bucket = argv[argv.index("--bucket") + 1]
            follow = [a for a in fake.calls_to("s3api", tagged_after[op]) if bucket in a]
            text = json.dumps(fake.file_of(follow[0], "--tagging"))
        else:
            text = " ".join(argv) + "".join(fake.files.get(a, "") for a in argv)
        assert "genealogy:rehearsal" in text and "genealogy:run" in text and run_id in text, op
        for flag in name_flags:
            if flag in argv and not argv[argv.index(flag) + 1].startswith("file://"):
                value = argv[argv.index(flag) + 1]
                assert value.lstrip("/").startswith("genealogy-u13"), (op, flag, value)
        if op in ("create-role", "create-instance-profile"):
            assert argv[argv.index("--path") + 1] == "/genealogy-u13/"


def test_no_secret_value_outside_the_secret_files(stack):
    env, fake, lines = stack
    values = secret_values(env)
    assert len(values) >= 5
    secret_files = {f"file://{p}" for p in (env["work"] / "secrets").iterdir()}
    for argv in fake.calls:
        joined = " ".join(argv)
        assert not any(v in joined for v in values), argv[:8]
    for ref, text in fake.files.items():
        if ref not in secret_files:
            assert not any(v in text for v in values), ref
    assert not any(any(v in line for v in values) for line in lines)


def test_option_settings_and_secret_strings_are_private_files(stack):
    env, fake, _ = stack
    seen = 0
    for argv in fake.calls:
        for flag in ("--option-settings", "--secret-string", "--options-to-remove"):
            if flag in argv:
                ref = argv[argv.index(flag) + 1]
                assert ref.startswith(f"file://{env['work']}"), (flag, ref)
                mode = stat.S_IMODE(Path(ref[len("file://"):]).stat().st_mode)
                assert mode == 0o600, (ref, oct(mode))
                seen += 1
    assert seen >= 9


def test_tiers_carry_their_security_group_profile_and_type(stack):
    env, _, _ = stack
    for tier in rh.TIERS:
        o = options_file(env, rh.ENV_NAMES[tier])
        assert o[(rh.LC_NS, "SecurityGroups")] == f"sg-{tier}", tier
        assert o[(rh.LC_NS, "IamInstanceProfile")].endswith(f"instance-profile/genealogy-u13/genealogy-u13-{tier}")
        assert o[(rh.INSTANCES_NS, "InstanceTypes")] == rh.INSTANCE_TYPES[tier]
        assert o[(rh.MANAGED_NS, "ManagedActionsEnabled")] == "false"
        assert (o[(rh.ASG_NS, "MinSize")], o[(rh.ASG_NS, "MaxSize")]) == ("1", "1")
        for var, key in rh.TIER_SECRETS[tier].items():
            assert o[(rh.SECRETS_NS, var)].startswith(f"arn:aws:secretsmanager:us-east-1:{ACCOUNT}:secret:genealogy-u13/{key}")


def test_tools_alb_is_internal_and_application(stack):
    env, _, _ = stack
    tools = options_file(env, rh.ENV_NAMES["tools"])
    assert tools[(rh.VPC_NS, "ELBScheme")] == "internal"
    assert tools[(rh.EBENV_NS, "LoadBalancerType")] == "application"
    assert tools[(rh.ELBV2_NS, "SecurityGroups")] == "sg-tools-alb"
    web = options_file(env, rh.ENV_NAMES["web"])
    assert web[(rh.EBENV_NS, "LoadBalancerType")] == "application"
    assert (rh.VPC_NS, "ELBScheme") not in web


def test_web_first_boot_has_no_sign_in_or_dev_login(env):
    fake = FakeAws()
    rc, _ = run(env, fake, "up", "--billed", "--phase", "all", "--bundles-dir", str(env["bundles"]),
                "--env-file", str(env["env_file"]))
    assert rc == 0
    creates_web = [a for a in fake.calls_to("elasticbeanstalk", "create-environment") if "genealogy-u13-web" in a]
    sent = {o["OptionName"] for o in fake.file_of(creates_web[0], "--option-settings")}
    assert not sent & {"PUBLIC_URL", "DEV_LOGIN", "FAMILYSEARCH_WEB_ENABLED", "ALLOWED_EMAILS"}


def test_signin_phase_sets_loopback_with_space_separated_emails(stack):
    env, _, _ = stack
    web = options_file(env, rh.ENV_NAMES["web"])
    assert web[(rh.ENV_NS, "PUBLIC_URL")] == "http://127.0.0.1:1837"
    assert web[(rh.ENV_NS, "FAMILYSEARCH_WEB_ENABLED")] == "true"
    assert web[(rh.ENV_NS, "ALLOWED_EMAILS")] == "a@example.invalid b@example.invalid"
    assert rh.EB_VALUE.match(web[(rh.ENV_NS, "ALLOWED_EMAILS")])


def test_secrets_shared_and_hex(stack):
    env, fake, _ = stack
    web, worker = options_file(env, rh.ENV_NAMES["web"]), options_file(env, rh.ENV_NAMES["worker"])
    assert web[(rh.SECRETS_NS, "FS_TOKEN_ENC_KEY")] == worker[(rh.SECRETS_NS, "FS_TOKEN_ENC_KEY")]
    for key in ("web/session-secret", "shared/fs-token-enc-key"):
        value = (env["work"] / "secrets" / key.replace("/", "--")).read_text(encoding="utf-8")
        assert re.fullmatch(r"[0-9a-f]{64}", value)
    model = (env["work"] / "secrets" / "worker--anthropic-api-key").read_text(encoding="utf-8")
    assert model == FAKE_MODEL_KEY


def test_rds_is_private_and_reached_only_from_tier_groups(stack):
    _, fake, _ = stack
    db = fake.calls_to("rds", "create-db-instance")[0]
    assert "--no-publicly-accessible" in db and "--publicly-accessible" not in db
    assert "--manage-master-user-password" in db and "--master-user-password" not in db
    rds_rules = [a for a in fake.calls_to("ec2", "authorize-security-group-ingress") if "sg-rds" in a]
    assert {a[a.index("--source-group") + 1] for a in rds_rules} == {"sg-web", "sg-worker", "sg-tools"}
    assert all("--cidr" not in a for a in fake.calls_to("ec2", "authorize-security-group-ingress"))


def test_data_bucket_blocks_public_access(stack):
    _, fake, _ = stack
    block = fake.calls_to("s3api", "put-public-access-block")[0]
    conf = block[block.index("--public-access-block-configuration") + 1]
    assert dict(kv.split("=") for kv in conf.split(",")) == {
        "BlockPublicAcls": "true", "IgnorePublicAcls": "true", "BlockPublicPolicy": "true",
        "RestrictPublicBuckets": "true"}
    assert fake.calls_to("s3api", "put-bucket-encryption")


def test_worker_sets_both_sqsd_namespaces_equal_to_the_template(stack):
    env, _, _ = stack
    worker = options_file(env, rh.ENV_NAMES["worker"])
    template = yaml.safe_load(rh.SQSD_CONFIG.read_text(encoding="utf-8"))["option_settings"]
    for ns in (rh.SQSD_NS, rh.ENV_NS):
        for name, value in template[ns].items():
            assert worker[(ns, name)] == str(value), (ns, name)


def test_queue_url_two_step(stack):
    env, fake, _ = stack
    create = [a for a in fake.calls_to("elasticbeanstalk", "create-environment") if "genealogy-u13-worker" in a][0]
    assert "QUEUE_URL" not in {o["OptionName"] for o in fake.file_of(create, "--option-settings")}
    url = options_file(env, rh.ENV_NAMES["worker"])[(rh.ENV_NS, "QUEUE_URL")]
    assert url.endswith("q-genealogy-u13-worker")
    assert options_file(env, rh.ENV_NAMES["web"])[(rh.ENV_NS, "QUEUE_URL")] == url


def test_storage_bucket_created_by_run_is_recorded(stack):
    env, _, _ = stack
    inv = json.loads((env["work"] / "inventory.json").read_text(encoding="utf-8"))
    storage = [r for r in inv["resources"] if r["kind"] == "eb-storage"]
    assert storage and storage[0]["created_by_run"] is True


# ── option guards ─────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("item", ["web:DEV_LOGIN=true", "worker:BLOCKED_TOOLS=Bash", "worker:DEV_PATHS=1",
                                  "worker:WORKER_TURN_USERS=none", "tools:GENEALOGY_DEBUG_HOLD_BEFORE_COMMIT_MS=1",
                                  "web:FOO=a?b", "worker:ANTHROPIC_API_KEY=sk-x", "web:PUBLIC_URL=https://x.invalid"])
def test_up_refuses_dev_secret_and_out_of_set_values(env, item):
    fake = FakeAws()
    rc, _ = up_all(env, fake, "--env", item)
    assert rc != 0
    tier = item.split(":")[0]
    assert not [a for a in fake.calls_to("elasticbeanstalk", "create-environment") if rh.ENV_NAMES[tier] in a]


def test_up_accepts_a_plain_operator_override(env):
    fake = FakeAws()
    rc, _ = up_all(env, fake, "--env", "tools:WIKI_API_URL=https://wiki.example.invalid")
    assert rc == 0
    assert options_file(env, rh.ENV_NAMES["tools"])[(rh.ENV_NS, "WIKI_API_URL")] == "https://wiki.example.invalid"


def _worker_opts(**drop):
    sqsd = rh.sqsd_template()
    out = [rh.opt(rh.SQSD_NS, k, v) for k, v in sqsd[rh.SQSD_NS].items()]
    out += [rh.opt(rh.ENV_NS, k, v) for k, v in sqsd[rh.ENV_NS].items() if k not in drop]
    return out


def test_check_options_refuses_a_sqsd_block_without_its_mirror():
    rh.check_options("worker", _worker_opts())
    with pytest.raises(rh.Die, match="SQSD_MAX_RETRIES"):
        rh.check_options("worker", _worker_opts(SQSD_MAX_RETRIES=1))
    bad = [o if o["OptionName"] != "SQSD_VISIBILITY_TIMEOUT_S" else rh.opt(rh.ENV_NS, o["OptionName"], "1")
           for o in _worker_opts()]
    with pytest.raises(rh.Die, match="VisibilityTimeout"):
        rh.check_options("worker", bad)


def test_check_options_is_order_independent():
    opts = _worker_opts()
    rh.check_options("worker", list(reversed(opts)))


def test_every_case_sets_mirrors_together():
    for name, case in rh.CASES.items():
        for tier in case.get("ops", {}):
            sets, removes = rh.case_options(case, tier)
            names = {(o["Namespace"], o["OptionName"]): o["Value"] for o in sets}
            removed = {(o["Namespace"], o["OptionName"]) for o in removes}
            for option, mirror in rh.MIRRORS.items():
                a, b = names.get((rh.SQSD_NS, option)), names.get((rh.ENV_NS, mirror))
                assert (a is None) == (b is None), (name, option)
                assert a == b, (name, option)
                assert ((rh.SQSD_NS, option) in removed) == ((rh.ENV_NS, mirror) in removed), name


def test_only_cases_set_dev_or_secret_shaped_names_and_values_are_literal():
    for name, case in rh.CASES.items():
        allowed = set(case.get("allow", ()))
        for tier, ops in case.get("ops", {}).items():
            for namespace, var, value in ops:
                if value is rh.REMOVE:
                    continue
                assert isinstance(value, str), (name, var)
                if namespace == rh.ENV_NS and (rh.is_dev_setting(tier, var, value) or rh.SECRET_NAME.search(var)):
                    assert var in allowed, (name, var)
                if rh.SECRET_NAME.search(var):
                    assert "DUMMY" in value or value.startswith("dev-insecure"), (name, var)
        assert case["measures"].startswith("M"), name


def test_cases_cover_the_plan_list():
    assert set(rh.CASES) == {
        "env_chars", "env_4096", "tools_single", "tools_classic", "ebext_naming", "graviton_boot",
        "tools_no_pgsslmode", "tools_no_dsn", "tools_bad_path_style", "tools_half_s3_pair", "worker_half_sqs",
        "web_half_sqs", "sqs_region_contradicts", "fast_errors", "maxretries_2", "maxretries_1", "tmpdir_bad",
        "worker_no_provider", "worker_no_tool_url", "worker_blocked_tools", "worker_no_queue_url",
        "worker_default_enc_key", "web_no_queue_url", "default_session_secret", "kill_window", "debug_hold",
        "refresh_age_0", "cap_1usd", "idle_session_60s"}


# ── probe cases ───────────────────────────────────────────────────────────────────────


def _updates(fake, name):
    return [a for a in fake.calls_to("elasticbeanstalk", "update-environment") if name in a]


def test_probe_restores_a_snapshot_value(stack):
    env, fake, _ = stack
    fake.reset()
    rc, _ = run(env, fake, "probe", "--billed", "--case", "maxretries_1", "--hold-s", "0")
    assert rc == 0
    apply, restore = _updates(fake, "genealogy-u13-worker")
    assert {o["OptionName"]: o["Value"] for o in fake.file_of(apply, "--option-settings")} == {
        "MaxRetries": "1", "SQSD_MAX_RETRIES": "1"}
    assert {o["OptionName"]: o["Value"] for o in fake.file_of(restore, "--option-settings")} == {
        "MaxRetries": "5", "SQSD_MAX_RETRIES": "5"}
    assert "--options-to-remove" not in restore
    assert fake.env_settings["genealogy-u13-worker"][(rh.SQSD_NS, "MaxRetries")] == "5"


def test_probe_removes_a_name_absent_from_the_snapshot(stack):
    env, fake, _ = stack
    fake.reset()
    rc, _ = run(env, fake, "probe", "--billed", "--case", "env_chars", "--hold-s", "0")
    assert rc == 0
    restore = _updates(fake, "genealogy-u13-web")[-1]
    assert "--option-settings" not in restore
    removed = {o["OptionName"] for o in fake.file_of(restore, "--options-to-remove")}
    assert removed == {"U13_PROBE_QUESTION", "U13_PROBE_AMP", "U13_PROBE_COMMA"}
    assert not [k for k in fake.env_settings["genealogy-u13-web"] if k[1].startswith("U13_PROBE")]


def test_probe_removes_error_visibility_when_the_snapshot_lacks_it(stack):
    env, fake, _ = stack
    path = env["work"] / "options" / "genealogy-u13-worker.json"
    snapshot = [o for o in json.loads(path.read_text(encoding="utf-8")) if o["OptionName"] != "ErrorVisibilityTimeout"]
    path.write_text(json.dumps(snapshot), encoding="utf-8")
    fake.reset()
    rc, _ = run(env, fake, "probe", "--billed", "--case", "fast_errors", "--hold-s", "0")
    assert rc == 0
    restore = _updates(fake, "genealogy-u13-worker")[-1]
    assert [o["OptionName"] for o in fake.file_of(restore, "--options-to-remove")] == ["ErrorVisibilityTimeout"]
    assert "--option-settings" not in restore


def test_probe_replaces_a_secret_mapping_and_restores_it(stack):
    env, fake, _ = stack
    arn = options_file(env, rh.ENV_NAMES["web"])[(rh.SECRETS_NS, "SESSION_SECRET")]
    fake.reset()
    rc, _ = run(env, fake, "probe", "--billed", "--case", "default_session_secret", "--hold-s", "0")
    assert rc == 0
    settings = fake.env_settings["genealogy-u13-web"]
    assert settings[(rh.SECRETS_NS, "SESSION_SECRET")] == arn
    assert (rh.ENV_NS, "SESSION_SECRET") not in settings


def test_idle_session_case_resets_the_parameter(stack):
    env, fake, _ = stack
    fake.reset()
    rc, _ = run(env, fake, "probe", "--billed", "--case", "idle_session_60s", "--hold-s", "0")
    assert rc == 0
    assert fake.ops().index(("rds", "modify-db-parameter-group")) < fake.ops().index(("rds", "reset-db-parameter-group"))
    reset = fake.calls_to("rds", "reset-db-parameter-group")[0]
    assert "ParameterName=idle_session_timeout,ApplyMethod=immediate" in reset


def test_throwaway_case_is_terminated(stack):
    env, fake, _ = stack
    fake.reset()
    rc, _ = run(env, fake, "probe", "--billed", "--case", "tools_single", "--hold-s", "0")
    assert rc == 0
    create = fake.calls_to("elasticbeanstalk", "create-environment")[0]
    assert "genealogy-u13-x-tools-single" in create
    sent = {o["OptionName"]: o["Value"] for o in fake.file_of(create, "--option-settings")}
    assert sent["EnvironmentType"] == "SingleInstance" and "LoadBalancerType" not in sent
    assert fake.calls_to("elasticbeanstalk", "terminate-environment")
    assert not fake.get("env", "genealogy-u13-x-tools-single")


@pytest.mark.parametrize("failure", ["exception", "interrupt"])
def test_probe_restores_on_exception_and_interrupt(stack, failure):
    env, fake, _ = stack
    fake.reset()

    def sleep(seconds):
        if seconds == 0:
            raise KeyboardInterrupt if failure == "interrupt" else RuntimeError("boom")

    if failure == "interrupt":
        rc, _ = run(env, fake, "probe", "--billed", "--case", "cap_1usd", "--hold-s", "0", sleep=sleep)
        assert rc == 130
    else:
        with pytest.raises(RuntimeError):
            run(env, fake, "probe", "--billed", "--case", "cap_1usd", "--hold-s", "0", sleep=sleep)
    assert len(_updates(fake, "genealogy-u13-worker")) == 2, "applied, then restored"
    assert (rh.ENV_NS, "SESSION_SPEND_CAP_USD") not in fake.env_settings["genealogy-u13-worker"]


def test_probe_restores_when_a_later_case_fails(stack):
    env, fake, _ = stack
    fake.reset()
    fake.fail["rds modify-db-parameter-group"] = "An error occurred (InvalidParameterValue)"
    rc, _ = run(env, fake, "probe", "--billed", "--case", "refresh_age_0", "--case", "idle_session_60s",
                "--hold-s", "0")
    assert rc != 0
    assert (rh.ENV_NS, "FS_GRANT_REFRESH_AGE_S") not in fake.env_settings["genealogy-u13-web"]
    assert fake.calls_to("rds", "reset-db-parameter-group"), "the failed case's own restore still runs"


# ── migrate ───────────────────────────────────────────────────────────────────────────


def test_migrate_policy_is_exactly_two_arns_and_no_secret_reaches_ssm(stack):
    env, fake, _ = stack
    put = [a for a in fake.calls_to("iam", "put-role-policy") if "genealogy-u13-migrate" in a][0]
    resource = fake.file_of(put, "--policy-document")["Statement"][0]["Resource"]
    web_dsn = options_file(env, rh.ENV_NAMES["web"])[(rh.SECRETS_NS, "PG_DSN")]
    assert sorted(resource) == sorted([MASTER_ARN, web_dsn])
    send = fake.calls_to("ssm", "send-command")[0]
    params = fake.files[send[send.index("--parameters") + 1]]
    for value in secret_values(env):
        assert value not in params
    script = fake.file_of(send, "--parameters")["commands"][0]
    assert MASTER_ARN in script and web_dsn in script and "sql.Literal" in script
    order = fake.ops()
    assert order.index(("ssm", "send-command")) < max(i for i, op in enumerate(order) if op == ("iam", "delete-role-policy"))


def test_migrate_policy_is_removed_when_the_command_fails(env):
    fake = FakeAws()
    fake.ssm_status = "Failed"
    rc, _ = up_all(env, fake)
    assert rc != 0
    deletes = [a for a in fake.calls_to("iam", "delete-role-policy") if "genealogy-u13-migrate" in a]
    assert deletes and fake.calls.index(deletes[0]) > fake.calls.index(fake.calls_to("ssm", "send-command")[0])


def test_migrate_policy_is_removed_when_send_command_raises(env):
    fake = FakeAws()
    fake.fail["ssm send-command"] = "An error occurred (InvalidInstanceId)"
    rc, _ = up_all(env, fake)
    assert rc != 0
    assert [a for a in fake.calls_to("iam", "delete-role-policy") if "genealogy-u13-migrate" in a]


# ── down and prove-empty ──────────────────────────────────────────────────────────────

# kind -> the call that deletes it (down) and the call that checks it (prove-empty).
DOWN = {
    "budget": ("budgets", "delete-budget"), "iam-role": ("iam", "delete-role"),
    "instance-profile": ("iam", "delete-instance-profile"), "sg": ("ec2", "delete-security-group"),
    "db-subnet-group": ("rds", "delete-db-subnet-group"), "db-param-group": ("rds", "delete-db-parameter-group"),
    "rds": ("rds", "delete-db-instance"), "s3": ("s3api", "delete-bucket"),
    "secret": ("secretsmanager", "delete-secret"), "ec2": ("ec2", "terminate-instances"),
    "app": ("elasticbeanstalk", "delete-application"), "eb-storage": ("s3api", "delete-bucket-policy"),
    "env": ("elasticbeanstalk", "terminate-environment"), "log-group": ("logs", "delete-log-group"),
    "resolver": ("route53resolver", "delete-resolver-query-log-config"),
}
PROOF = {
    "budget": ("budgets", "describe-budget"), "iam-role": ("iam", "list-roles"),
    "instance-profile": ("iam", "list-instance-profiles"), "sg": ("ec2", "describe-security-groups"),
    "db-subnet-group": ("rds", "describe-db-subnet-groups"), "db-param-group": ("rds", "describe-db-parameter-groups"),
    "rds": ("rds", "describe-db-instances"), "s3": ("s3api", "list-buckets"),
    "secret": ("secretsmanager", "list-secrets"), "ec2": ("ec2", "describe-instances"),
    "app": ("elasticbeanstalk", "describe-applications"), "eb-storage": ("s3api", "head-bucket"),
    "env": ("elasticbeanstalk", "describe-environments"), "log-group": ("logs", "describe-log-groups"),
    "resolver": ("route53resolver", "list-resolver-query-log-configs"),
}


def test_up_down_and_proof_cover_the_same_kinds(stack):
    env, fake, _ = stack
    assert set(DOWN) == set(PROOF) == set(rh.KINDS)
    inv = json.loads((env["work"] / "inventory.json").read_text(encoding="utf-8"))
    assert {r["kind"] for r in inv["resources"]} == set(rh.KINDS)
    fake.reset()
    rc, _ = run(env, fake, "down", "--billed")
    assert rc == 0
    ops = set(fake.ops())
    missing = {k: v for k, v in DOWN.items() if v not in ops}
    assert not missing, f"down never deletes {missing}"
    fake.reset()
    rc, lines = run(env, fake, "prove-empty")
    assert rc == 0, [line for line in lines if "NOT EMPTY" in line]
    ops = set(fake.ops())
    missing = {k: v for k, v in PROOF.items() if v not in ops}
    assert not missing, f"prove-empty never checks {missing}"
    assert not [k for k in fake.have if not k.startswith(("version:",))], fake.have.keys()


def test_down_order_follows_the_plan(stack):
    env, fake, _ = stack
    fake.reset()
    assert run(env, fake, "down", "--billed")[0] == 0
    ops = fake.ops()

    def first(op):
        return ops.index(op)

    assert first(("elasticbeanstalk", "terminate-environment")) < first(("ec2", "terminate-instances")) \
        < first(("rds", "delete-db-instance")) < first(("elasticbeanstalk", "delete-application")) \
        < first(("secretsmanager", "delete-secret")) < first(("ec2", "delete-security-group")) \
        < first(("iam", "delete-instance-profile")) < first(("iam", "delete-role")) \
        < first(("budgets", "delete-budget")) < first(("route53resolver", "delete-resolver-query-log-config"))
    sgs = [a[a.index("--group-id") + 1] for a in fake.calls_to("ec2", "delete-security-group")]
    assert sgs == ["sg-rds", "sg-tools-alb", "sg-web", "sg-worker", "sg-tools"]


def test_down_deletes_a_storage_bucket_it_created_policy_first(stack):
    env, fake, _ = stack
    fake.reset()
    assert run(env, fake, "down", "--billed")[0] == 0
    storage = f"elasticbeanstalk-us-east-1-{ACCOUNT}"
    seq = [op for op, a in zip(fake.ops(), fake.calls) if storage in " ".join(a)]
    assert ("s3", "rm") in seq
    assert seq.index(("s3", "rm")) < seq.index(("s3api", "delete-bucket-policy")) < seq.index(("s3api", "delete-bucket"))
    rm = [a for a in fake.calls_to("s3", "rm") if storage in " ".join(a)][0]
    assert f"s3://{storage}" in rm, "the whole bucket, not a prefix"


def test_down_leaves_a_storage_bucket_it_did_not_create(env):
    fake = FakeAws()
    fake.add("bucket", f"elasticbeanstalk-us-east-1-{ACCOUNT}")
    assert up_all(env, fake)[0] == 0
    fake.reset()
    assert run(env, fake, "down", "--billed")[0] == 0
    storage = f"elasticbeanstalk-us-east-1-{ACCOUNT}"
    assert not [a for a in fake.calls_to("s3api", "delete-bucket") if storage in a]
    assert not fake.calls_to("s3api", "delete-bucket-policy")
    assert [a for a in fake.calls_to("s3", "rm") if f"s3://{storage}/genealogy-u13/" in a]
    fake.reset()
    assert run(env, fake, "prove-empty")[0] == 0
    assert not [a for a in fake.calls_to("s3api", "head-bucket") if storage in a]
    assert [a for a in fake.calls_to("s3api", "list-objects-v2") if "genealogy-u13/" in a]


@pytest.mark.parametrize("leftover", ["tagged", "stack", "storage_403", "secret", "eip"])
def test_prove_empty_fails_on_anything_left(stack, leftover):
    env, fake, _ = stack
    assert run(env, fake, "down", "--billed")[0] == 0
    if leftover == "tagged":
        fake.leftover["tagged"] = [f"arn:aws:sqs:us-east-1:{ACCOUNT}:stray"]
    elif leftover == "stack":
        fake.leftover["stack"] = True
    elif leftover == "storage_403":
        fake.leftover["forbidden_buckets"] = [f"elasticbeanstalk-us-east-1-{ACCOUNT}"]
    elif leftover == "secret":
        fake.add("secret", "genealogy-u13/web/pg-dsn", arn="x")
    else:
        fake.leftover["eip"] = [{"PublicIp": "192.0.2.1"}]
    rc, lines = run(env, fake, "prove-empty", "--repoll-s", "0")
    assert rc == 1, lines
    assert any("NOT EMPTY" in line for line in lines)


# ── status ────────────────────────────────────────────────────────────────────────────


def test_status_prints_daily_cost_even_when_budgets_is_denied(stack):
    env, fake, _ = stack
    fake.fail["budgets describe-budget"] = "An error occurred (AccessDeniedException)"
    rc, lines = run(env, fake, "status")
    assert any(line.startswith("daily cost 2026-09-") for line in lines)
    assert any("budget: unreadable" in line for line in lines)
    assert rc == 0


def test_status_exits_nonzero_on_drift(stack):
    env, fake, _ = stack
    fake.env_settings["genealogy-u13-worker"][(rh.SQSD_NS, "MaxRetries")] = "1"
    rc, lines = run(env, fake, "status")
    assert rc == 1
    assert any("drift" in line and "MaxRetries" in line for line in lines)


# ── dry-run ───────────────────────────────────────────────────────────────────────────


def _no_aws(argv):
    raise AssertionError(f"dry-run called aws: {argv}")


@pytest.mark.parametrize("cmd", [["plan"], ["up", "--phase", "all", "--phase", "signin", "--phase", "resolver",
                                            "--dry-run"],
                                 ["down", "--dry-run"], ["probe", "--case", "kill_window", "--case",
                                                         "idle_session_60s", "--case", "graviton_boot", "--dry-run"]])
def test_dry_run_calls_nothing_and_prints_pasteable_commands(env, cmd):
    rc, lines = run(env, _no_aws, *cmd)
    assert rc == 0, lines[-3:]
    commands = [line[2:] for line in lines if line.startswith("+ ")]
    assert commands
    for c in commands:
        argv = shlex.split(c)
        assert argv[0] == "aws" and argv[argv.index("--region") + 1] == "us-east-1"
    assert not (env["work"] / "secrets").exists(), "a dry-run writes no secret"
    assert not (env["work"] / "inventory.json").exists()
    assert not (env["work"] / "options").exists(), "a dry-run never touches the probe snapshots"


def test_dry_run_secret_strings_are_paths(env):
    _, lines = run(env, _no_aws, "plan")
    secret_lines = [line for line in lines if line.startswith("+ ") and "--secret-string" in line]
    assert len(secret_lines) == len(rh.SECRET_KEYS)
    assert all("--secret-string file://" in line for line in secret_lines)


def test_plan_with_another_instance_class_still_passes(env, monkeypatch):
    monkeypatch.setitem(rh.INSTANCE_TYPES, "worker", "m7i.large")
    rc, lines = run(env, _no_aws, "plan")
    assert rc == 0


# ── the D9 leak check ─────────────────────────────────────────────────────────────────


def _git(repo: Path, *args: str) -> str:
    return subprocess.run(["git", "-c", "user.email=t@example.invalid", "-c", "user.name=t",
                           "-c", "commit.gpgsign=false", *args], cwd=repo, check=True, capture_output=True,
                          text=True, encoding="utf-8").stdout


@pytest.fixture
def leak_repo(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    _git(repo, "init", "-q", "-b", "main")
    (repo / ".gitignore").write_text(".local/\n", encoding="utf-8")
    (repo / "README.md").write_text("account <account>, zone <zone>, host <host>\n", encoding="utf-8")
    _git(repo, "add", ".")
    _git(repo, "commit", "-q", "-m", "init")
    _git(repo, "checkout", "-q", "-b", "work")
    local = repo / ".local"
    local.mkdir()
    planted = "4" * 4 + "3" * 4 + "2" * 4
    (local / "account").write_text(planted + "\n", encoding="utf-8")
    (local / "zone").write_text("zone.example.invalid\n", encoding="utf-8")
    return {"repo": repo, "local": local, "value": planted, "work": tmp_path / "leakwork"}


def _leak(leak_repo, *extra):
    lines = []
    rc = rh.main(["leak-check", "--work-dir", str(leak_repo["work"]), *extra], out=lines.append,
                 local_dir=leak_repo["local"], repo=leak_repo["repo"])
    return rc, lines


def test_leak_check_clean_and_placeholders_pass(leak_repo):
    rc, lines = _leak(leak_repo)
    assert rc == 0, lines


def test_leak_check_finds_a_tracked_file(leak_repo):
    (leak_repo["repo"] / "README.md").write_text(f"oops {leak_repo['value']}\n", encoding="utf-8")
    _git(leak_repo["repo"], "commit", "-q", "-am", "edit")
    rc, lines = _leak(leak_repo)
    assert rc == 1 and any("README.md:1" in line for line in lines)
    assert not any(leak_repo["value"] in line for line in lines), "a hit names the place, not the value"


def test_leak_check_finds_an_untracked_file(leak_repo):
    (leak_repo["repo"] / "new.md").write_text("zone.example.invalid\n", encoding="utf-8")
    rc, _ = _leak(leak_repo)
    assert rc == 1


def test_leak_check_finds_a_body_file_and_a_commit_message(leak_repo, tmp_path):
    body = tmp_path / "body.md"
    body.write_text(f"deployed to {leak_repo['value']}\n", encoding="utf-8")
    assert _leak(leak_repo, "--body", str(body))[0] == 1
    (leak_repo["repo"] / "x.txt").write_text("x\n", encoding="utf-8")
    _git(leak_repo["repo"], "add", "x.txt")
    _git(leak_repo["repo"], "commit", "-q", "-m", f"rehearsal on {leak_repo['value']}")
    rc, lines = _leak(leak_repo)
    assert rc == 1 and any("commit messages" in line for line in lines)


def test_leak_check_refuses_an_empty_value(leak_repo):
    (leak_repo["local"] / "host").write_text("  \n", encoding="utf-8")
    rc, _ = _leak(leak_repo)
    assert rc == 2


def test_leak_check_skips_without_local(leak_repo):
    lines = []
    rc = rh.main(["leak-check"], out=lines.append, local_dir=leak_repo["repo"] / "absent", repo=leak_repo["repo"])
    assert rc == 0 and lines == ["leak-check: skipped, no .local/"]


def test_leak_check_patterns_file_stays_outside_the_repo(leak_repo):
    _leak(leak_repo)
    assert stat.S_IMODE((leak_repo["work"] / "leak-patterns").stat().st_mode) == 0o600
    assert "leak-patterns" not in _git(leak_repo["repo"], "status", "--porcelain", "--untracked-files=all")


# ── the 12-digit scan (D9, CI) ────────────────────────────────────────────────────────

TWELVE = re.compile(r"(?<![A-Za-z0-9-])\d{12}(?![A-Za-z0-9-])")
ALLOWED_IDS = {"000000000000", "123456789012"}
SCAN_PATHS = ("apps/server/proto/eb-rehearsal", "apps/server/tests/test_proto_rehearsal.py",
              "apps/server/tests/test_proto_target.py", "apps/server/tests/fixtures/eb-cloudwatch",
              "docs/plan/familysearch-handoff.md", "docs/search-agent-prototype-report.md")


def account_ids(text: str) -> list[str]:
    return [m for m in TWELVE.findall(text) if m not in ALLOWED_IDS]


def test_account_id_pattern_variants():
    planted = "2109" + "87654321"
    assert account_ids(f"fixture {planted}\n") == [planted]
    assert account_ids(f"deployed to {planted} today.") == [planted]
    assert account_ids(f"v{planted}x") == []
    assert account_ids(f"arn:aws:iam::{planted}:role/x") == [planted]
    assert account_ids(f"the id is {planted}, recorded") == [planted]
    assert account_ids("elasticmq 000000000000 and the AWS example 123456789012") == []
    assert account_ids("uuid 7d1c2f3a-0b9e-4c8d-9f00-000000000001") == []
    assert account_ids("sha256 0123456789abcdef0123456789") == []


def test_no_account_id_in_the_rehearsal_files():
    listed = subprocess.run(["git", "ls-files", "--cached", "--others", "--exclude-standard", "--", *SCAN_PATHS],
                            cwd=REPO, capture_output=True, text=True, encoding="utf-8", check=True).stdout.split()
    assert "apps/server/proto/eb-rehearsal/rehearse.py" in listed
    hits = {}
    for rel in listed:
        path = REPO / rel
        if path.is_file():
            found = account_ids(path.read_text(encoding="utf-8", errors="replace"))
            if found:
                hits[rel] = len(found)
    assert not hits, f"a 12-digit run in {hits}: use <account> (D9)"
