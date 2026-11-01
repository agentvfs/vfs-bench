"""A stand-in judge: an OpenAI-compatible chat completions server on localhost.

    uv run --project harbor python -I harbor/mock_judge.py
        [--host 127.0.0.1] [--port 8765] [--score 1.0] [--content <text>]
        [--log <file>]

It answers every ``POST /v1/chat/completions`` with one message whose
content is upstream's judge reply, ``{"score": <score>, "reasoning":
"mock judge"}`` (or ``--content`` as given: Gaia2's checkers read
``[[Success]]``/``[[True]]`` or ``[[Failure]]``/``[[False]]``), and logs
each request's model and the start of its last message. It checks the
judge's plumbing (the verifier's route to the API, the key, the model name,
the reply's parsing) without a real model, so the scores it gives are not a
judgment of anything. A verifier's VM reaches
it as ``OPENAI_BASE_URL=http://host.microsandbox.internal:<port>/v1``.
"""
import argparse
import json
import socket
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--score", type=float, default=1.0)
    parser.add_argument(
        "--content",
        help="the reply's content as given, in place of the score's JSON")
    parser.add_argument("--log")
    args = parser.parse_args()

    class Handler(BaseHTTPRequestHandler):

        def do_POST(self):
            body = json.loads(
                self.rfile.read(int(self.headers.get("content-length", 0)))
                or b"{}")
            if not self.path.endswith("/chat/completions"):
                self.send_error(404)
                return
            last = (body.get("messages") or [{}])[-1].get("content")
            if args.log:
                with open(args.log, "a") as f:
                    f.write(
                        json.dumps(
                            {
                                "model": body.get("model"),
                                "auth": bool(self.headers.get(
                                    "authorization")),
                                "last": str(last)[:200]
                            },
                            ensure_ascii=False) + "\n")
            content = (args.content if args.content is not None else
                       json.dumps({
                           "score": args.score,
                           "reasoning": "mock judge"
                       }))
            reply = json.dumps({
                "id":
                "mock",
                "object":
                "chat.completion",
                "created":
                0,
                "model":
                body.get("model", "mock"),
                "choices": [{
                    "index": 0,
                    "finish_reason": "stop",
                    "message": {
                        "role": "assistant",
                        "content": content
                    }
                }],
                "usage": {
                    "prompt_tokens": 0,
                    "completion_tokens": 0,
                    "total_tokens": 0
                },
            }).encode()
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(reply)))
            self.end_headers()
            self.wfile.write(reply)

        def log_message(self, *_):
            pass

    class Server(ThreadingHTTPServer):
        address_family = (socket.AF_INET6
                          if ":" in args.host else socket.AF_INET)

    Server((args.host, args.port), Handler).serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
