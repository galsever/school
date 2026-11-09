import os
import sys
import tempfile
from pathlib import Path

# The server keeps its secrets and the absence database in DATA_DIR: tests get an empty one.
os.environ["DATA_DIR"] = tempfile.mkdtemp(prefix="school-test-")
os.environ["APP_AUTH"] = "none"
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
