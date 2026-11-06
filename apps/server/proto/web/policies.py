"""The privacy and terms pages the chat-off tier serves (#3993).

Two string constants in a top-level module on purpose: the Beanstalk web bundle copies only
the top-level ``*.py`` files of ``proto/web/`` (``scripts/eb_bundles/build.py``), so an
``.html`` file or a ``policies/`` folder would pass on compose and 404 there. No absolute
links: the edge strips a path prefix (``auth.base_path()``).

Both begin with the word "Placeholder" until the lead supplies GeneFun's text (L1).
"""

from __future__ import annotations

PRIVACY_HTML = """<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Privacy</title></head>
<body>
<h1>Privacy</h1>
<p>Placeholder: GeneFun's privacy policy text has not been supplied yet.</p>
</body>
</html>
"""

TERMS_HTML = """<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Terms</title></head>
<body>
<h1>Terms</h1>
<p>Placeholder: GeneFun's terms of use have not been supplied yet.</p>
</body>
</html>
"""
