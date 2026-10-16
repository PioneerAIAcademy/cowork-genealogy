"""obs.setup_logging() makes the control plane's own `app.*` lines visible (#3305).

It used to configure only `workbench`. Every control-plane module logs through
logging.getLogger(__name__), under `app`, and uvicorn configures neither logger, so their
INFO lines were dropped in production and their WARNINGs came out only through Python's
last-resort handler. That is why, when #3305 asked whether a control-plane loop was
running, its own log lines could not be read."""
from __future__ import annotations

import logging

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app import obs
from app.db import get_engine


@pytest.fixture
def fresh_logging(monkeypatch):
    """setup_logging() configures once per process: give each test a first run, then
    put every logger it could touch back the way it was."""
    monkeypatch.setattr(obs, "_configured", False)
    loggers = [logging.getLogger(name) for name in ("workbench", "app")] + [logging.getLogger()]
    saved = [(lg, lg.level, list(lg.handlers)) for lg in loggers]
    yield
    for lg, level, handlers in saved:
        lg.setLevel(level)
        lg.handlers[:] = handlers


def test_app_info_lines_reach_stdout_and_debug_lines_do_not(fresh_logging, capsys):
    obs.setup_logging()
    logging.getLogger("app.sandbox.e2b").info("resumed sandbox %s", "sbx_1")
    logging.getLogger("app.sandbox.e2b").debug("a debug line")
    out = capsys.readouterr().out
    assert "INFO app.sandbox.e2b resumed sandbox sbx_1" in out
    assert "a debug line" not in out


def test_the_root_logger_is_left_alone(fresh_logging, capsys):
    """httpx, under both the e2b SDK and the Anthropic proxy, logs every request at
    INFO. Configuring the root logger instead of `app` would print all of them."""
    obs.setup_logging()
    logging.getLogger("httpx").info("HTTP Request: POST https://api.e2b.app/sandboxes")
    assert "HTTP Request" not in capsys.readouterr().out


def test_a_workbench_line_prints_exactly_once(fresh_logging, capsys):
    obs.setup_logging()
    obs.setup_logging()  # a second call must not add a second handler
    obs.log.info("session %s opened", "prj_1")
    assert capsys.readouterr().out.count("session prj_1 opened") == 1


def test_a_database_error_does_not_carry_its_bound_parameters():
    """The revocation sweep binds users' emails and logs its failure with the traceback,
    so SQLAlchemy must not echo bound values into its error messages."""
    with pytest.raises(DBAPIError) as excinfo:
        with get_engine().connect() as conn:
            conn.execute(text("SELECT * FROM no_such_table WHERE email = :email"),
                         {"email": "someone@example.org"})
    assert "someone@example.org" not in str(excinfo.value)
