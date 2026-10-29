# Upstream's solution/solve.sh, through the CLI: log in, file the trip's five
# expenses under their categories as "NYC Client Visit", and submit it.
finance login --username admin --password admin123

id=$(finance create-expense-report --trip-name 'NYC Client Visit' --items '[{"expense_category":"transport","amount":45.00},{"expense_category":"meals","amount":85.50},{"expense_category":"transport","amount":32.00},{"expense_category":"flight","amount":450.00},{"expense_category":"hotel","amount":750.00}]' | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')
finance submit-expense-report --id "$id"
