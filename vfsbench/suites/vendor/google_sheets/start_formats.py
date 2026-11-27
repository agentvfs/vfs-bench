"""Start the original v1 cell-format compatibility proxy on a private loopback port."""

from contextlib import contextmanager
from http.server import ThreadingHTTPServer
import signal
import sys
from threading import Event, Thread


@contextmanager
def background(handler, port=0):
    with ThreadingHTTPServer(("127.0.0.1", port), handler) as server:
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            yield f"http://127.0.0.1:{server.server_port}"
        finally:
            server.shutdown()
            thread.join()


if __name__ == "__main__":
    from sheet_formats import serve
    stop = Event()
    signal.signal(signal.SIGTERM, lambda *_: stop.set())
    with serve(sys.argv[1], state_path=sys.argv[2]) as url:
        print("SHEETS_URL=" + url, flush=True)
        stop.wait()
