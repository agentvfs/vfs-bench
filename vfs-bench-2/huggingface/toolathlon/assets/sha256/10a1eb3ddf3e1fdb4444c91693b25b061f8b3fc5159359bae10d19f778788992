import sys
from pathlib import Path

sys.path.insert(
    0, str(Path(__file__).resolve().parents[5] / "redirect" / "eval_shim"))

# Three, because this evaluator reads back both services and reads the Hub
# two ways. `github_host` rewrites the api.github.com constant onto the fake;
# `hf_token` signs the huggingface_hub calls with the run's tenant instead of
# upstream's unfilled "XX"; `hf_host` catches the one read that goes around
# the library entirely, a bare `requests.get` at a literal huggingface.co URL.
import github_host  # noqa: E402,F401
import hf_host  # noqa: E402,F401
import hf_token  # noqa: E402,F401
