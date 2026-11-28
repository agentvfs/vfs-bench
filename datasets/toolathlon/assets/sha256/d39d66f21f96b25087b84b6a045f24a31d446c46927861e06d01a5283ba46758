#!/usr/bin/env python3
import csv
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "..", "server", "clients"))

import gws  # noqa: E402

SHEET_NAME = "NHL-B2B-Analysis"


def main() -> int:
    sheets = gws.find(SHEET_NAME, gws.SHEET_MIME)
    if not sheets:
        print(f"FAIL: no spreadsheet named {SHEET_NAME} found")
        return 1
    sheet_id = sheets[0]["id"]

    with open(os.path.join(HERE, "gt.csv")) as f:
        gt = [row for row in csv.reader(f)]

    # The answer may land on any tab, so scan them for the header row.
    titles = gws.tabs(sheet_id)
    got, found_on = [], None
    for title in titles:
        rows = gws.read_values(sheet_id, f"{title}!A1:F40")
        rows = [[str(c).strip() for c in row] for row in rows if row]
        if rows and rows[0] == gt[0]:
            got, found_on = rows, title
            break

    if not got:
        print(f"FAIL: no tab carries the header {gt[0]}. tabs={titles}")
        return 1
    print(f"(answer found on tab '{found_on}')")

    formulas = [c for row in got[1:] for c in row[1:] if c.startswith("=")]
    if formulas:
        print(f"INCONCLUSIVE: {len(formulas)} cells hold unevaluated formulas "
              f"(e.g. {formulas[0][:60]}...). The mock GWS server stores "
              f"literal values and does not evaluate formulas, so a "
              f"spreadsheet-side computation cannot be scored here.")
        return 2

    got_rows = {r[0]: r[1:] for r in got[1:]}
    gt_rows = {r[0]: r[1:] for r in gt[1:]}
    if set(got_rows) != set(gt_rows):
        print(
            f"FAIL: team sets differ. missing={set(gt_rows) - set(got_rows)} "
            f"extra={set(got_rows) - set(gt_rows)}")
        return 1

    bad = [t for t in gt_rows if got_rows[t] != gt_rows[t]]
    if bad:
        for t in bad[:5]:
            print(f"  {t}: got={got_rows[t]} want={gt_rows[t]}")
        print(f"FAIL: {len(bad)}/{len(gt_rows)} team rows wrong")
        return 1

    print(f"PASS: {len(gt_rows)} teams, all values match gt.csv")
    return 0


if __name__ == "__main__":
    sys.exit(main())
