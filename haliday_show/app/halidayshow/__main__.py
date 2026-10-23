import logging
import os
from pathlib import Path

from aiohttp import web

from . import __version__
from .server import make_app


def main():
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO").upper(),
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    config_dir = Path(os.environ.get("HALIDAY_SHOW_CONFIG", "/config"))
    media_dir = Path(os.environ.get("HALIDAY_SHOW_MEDIA", "/media"))
    allow_all = os.environ.get("HALIDAY_SHOW_ALLOW_ALL") == "1"
    # Only outside Home Assistant: the add-on is reached through ingress, never a password.
    password = "" if os.environ.get("SUPERVISOR_TOKEN") else os.environ.get("HALIDAY_SHOW_PASSWORD", "")
    port = int(os.environ.get("HALIDAY_SHOW_PORT", "8099"))
    log = logging.getLogger(__name__)
    log.info("HA-liday Show %s on port %d", __version__, port)
    if allow_all:
        log.info("open to anyone on the network (HALIDAY_SHOW_ALLOW_ALL=1)")
    elif password:
        log.info("other devices need the password (HALIDAY_SHOW_PASSWORD)")
    web.run_app(make_app(config_dir, media_dir, allow_all=allow_all, password=password, read_stdin=True),
                port=port,
                access_log=None, print=None)


def standalone():
    """The haliday-show command (a pipx install): keep everything under ~/haliday-show unless told otherwise."""
    home = Path.home() / "haliday-show"
    os.environ.setdefault("HALIDAY_SHOW_CONFIG", str(home / "config"))
    os.environ.setdefault("HALIDAY_SHOW_MEDIA", str(home / "media"))
    main()


if __name__ == "__main__":
    main()
