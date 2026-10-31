# Data Workbench Runtime

This task-local runtime is offline and already provisioned. Package installation
is unavailable. Use the following generic utilities instead of attempting to
download dependencies.

- CSV, JSON, and Markdown: `python3` with pandas, NumPy and PyArrow; `jq`,
  `grep`, `awk`, `sed` and the other shell text tools.
- SQLite: Python's `sqlite3` module.
- PDF: PyMuPDF (`fitz`) and pypdf in `python3`; the `read_file` tool shows a
  PDF to you directly.
- Images: Pillow (`PIL`) and OpenCV (`cv2`) in `python3`; the `read_file` tool
  shows an image to you directly. OCR is not installed.
- Video: not supported. Offline speech recognition is not installed.

The benchmark workspace is read-only. Write scripts, intermediate files, and
the final `prediction.csv` only to the provided output directory.
