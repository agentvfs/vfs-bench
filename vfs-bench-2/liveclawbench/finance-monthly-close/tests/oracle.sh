# Upstream's solution/solve.sh, through the CLI, with each id read from the
# listings: flag the account off its statement by more than $400 and the
# pending transactions over $50,000, file and submit the trip's expense
# report, and invoice Globex Systems.
finance login --username admin --password admin123

for id in $(finance list-accounts | python3 -c 'import json,sys; print(" ".join(str(a["id"]) for a in json.load(sys.stdin)["data"] if abs(a["system_balance"] - a["statement_balance"]) > 400))'); do finance flag-account --id "$id"; done

for id in $(finance list-transactions --status pending | python3 -c 'import json,sys; print(" ".join(str(t["id"]) for t in json.load(sys.stdin)["data"] if t["amount"] > 50000))'); do finance flag-transaction --id "$id"; done

id=$(finance create-expense-report --trip-name 'March Marketing Trip' --items '[{"expense_category":"flight","amount":1200},{"expense_category":"hotel","amount":900},{"expense_category":"meals","amount":350}]' | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')
finance submit-expense-report --id "$id"

vendor=$(finance list-vendors | python3 -c 'import json,sys; print(next(v["id"] for v in json.load(sys.stdin)["data"] if v["vendor_name"] == "Globex Systems"))')
finance create-invoice --vendor-id "$vendor" --invoice-number INV-2026-004 --invoice-date 2026-03-01 --items '[{"description":"Travel Expenses","category_code":"5100","amount":5000},{"description":"Consulting","category_code":"5400","amount":3000}]'
