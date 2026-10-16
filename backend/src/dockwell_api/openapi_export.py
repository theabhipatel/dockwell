"""Print the OpenAPI schema (used to generate the frontend's typed API client)."""

import json
import sys

from dockwell_api.main import app

if __name__ == "__main__":
    json.dump(app.openapi(), sys.stdout, indent=2)
    sys.stdout.write("\n")
