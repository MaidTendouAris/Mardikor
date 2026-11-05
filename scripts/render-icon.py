"""Compatibility entry point; all artwork is now rendered from the SVG sources."""
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[1]
subprocess.run(["node", str(root / "scripts" / "render-icons.cjs")], cwd=root, check=True)
