"""MCPB entry point: run the code-browser-mcp server from PyPI.

The host passes every user_config field as an environment variable, an empty string when the user left it
blank. The server reads an empty CODE_BROWSER_* value as set, so blank ones are dropped first.
"""
import os

for _name in [n for n, v in os.environ.items() if n.startswith("CODE_BROWSER_") and not v.strip()]:
    del os.environ[_name]

from code_browser_mcp.server import main  # noqa: E402

if __name__ == "__main__":
    main()
