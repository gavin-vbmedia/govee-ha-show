import logging
import os
from pathlib import Path

from aiohttp import web

from . import __version__
from .server import make_app


def main():
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO").upper(),
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    config_dir = Path(os.environ.get("GOVEE_SHOW_CONFIG", "/config"))
    media_dir = Path(os.environ.get("GOVEE_SHOW_MEDIA", "/media"))
    allow_all = os.environ.get("GOVEE_SHOW_ALLOW_ALL") == "1"
    port = int(os.environ.get("GOVEE_SHOW_PORT", "8099"))
    logging.getLogger(__name__).info("Govee Light Show %s on port %d", __version__, port)
    web.run_app(make_app(config_dir, media_dir, allow_all=allow_all), port=port,
                access_log=None, print=None)


if __name__ == "__main__":
    main()
