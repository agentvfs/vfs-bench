import csv
import os
import sys

import psycopg2

FOLDER_ID = "nhl-b2b-folder"
FOLDER_NAME = "NHL-B2B-Analysis"
SOURCE_ID = "nhl-2425-schedule"
SOURCE_TITLE = "NHL 2425 Schedule"
TAB = "Sheet1"

HERE = os.path.dirname(os.path.abspath(__file__))
FIXTURE = os.path.join(os.path.dirname(HERE), "shared", "nhl.csv")

DB = {
    "host": os.environ.get("PGHOST", "localhost"),
    "port": int(os.environ.get("PGPORT", "5432")),
    "dbname": os.environ.get("PGDATABASE", "toolathlon_gym"),
    "user": os.environ.get("PGUSER", "eigent"),
    "password": os.environ.get("PGPASSWORD", "camel"),
}


def main() -> int:
    with open(FIXTURE, newline="") as fh:
        rows = [r for r in csv.reader(fh) if r]

    conn = psycopg2.connect(**DB)
    try:
        with conn.cursor() as cur:
            for table in ("cells", "sheets", "spreadsheets", "folders"):
                cur.execute(f"DELETE FROM gsheet.{table}")
            cur.execute(
                "INSERT INTO gsheet.folders (id, name, parent_id) "
                "VALUES (%s, %s, NULL)", (FOLDER_ID, FOLDER_NAME))
            cur.execute(
                "INSERT INTO gsheet.spreadsheets (id, title, folder_id) "
                "VALUES (%s, %s, %s)", (SOURCE_ID, SOURCE_TITLE, FOLDER_ID))
            cur.execute(
                "INSERT INTO gsheet.sheets "
                "(spreadsheet_id, title, index, row_count, column_count) "
                "VALUES (%s, %s, 0, %s, %s) RETURNING id",
                (SOURCE_ID, TAB, max(len(rows), 1000), max(len(rows[0]), 26)))
            sheet_id = cur.fetchone()[0]
            cur.executemany(
                "INSERT INTO gsheet.cells (spreadsheet_id, sheet_id,"
                " row_index, col_index, value, formatted_value)"
                " VALUES (%s,%s,%s,%s,%s,%s)",
                [(SOURCE_ID, sheet_id, r, c, v, v)
                 for r, row in enumerate(rows) for c, v in enumerate(row)])
        conn.commit()
    finally:
        conn.close()

    print(f"PGPORT={DB['port']}")
    print(f"folder_id={FOLDER_ID}")
    print(f"source_spreadsheet_id={SOURCE_ID}")
    print(f"seeded_rows={len(rows)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
