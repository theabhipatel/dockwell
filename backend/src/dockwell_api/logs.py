"""Central logging setup. Every module logs through `logging.getLogger("dockwell.<area>")`.

Never log secrets: API keys, session tokens, passwords, provider keys or prompt content.
"""

import logging
import sys

from dockwell_api.config import get_settings

_configured = False


def setup_logging() -> None:
    global _configured
    if _configured:
        return
    _configured = True
    handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(
        logging.Formatter("%(asctime)s %(levelname)-7s %(name)s: %(message)s", "%H:%M:%S")
    )
    root = logging.getLogger("dockwell")
    root.setLevel(get_settings().log_level.upper())
    root.addHandler(handler)
    root.propagate = False


def get_logger(area: str) -> logging.Logger:
    return logging.getLogger(f"dockwell.{area}")
