# Who this is, and what the lab folder holds.
box get-current-user | jq '{id, name, login}'

box search-for-content --query rare_books_conservation --type folder | jq -r '.entries[] | "\(.id) \(.name)"'

box list-items-in-folder --folder-id 3578701092 | jq -r '.entries[] | "\(.id) \(.type) \(.name)"'

box list-items-in-folder --folder-id 4023537767 | jq -r '.entries[] | "\(.id) \(.type) \(.name)"'

box get-file-information --file-id 2679438618 | jq '{id, name, size}'; box get-file-information --file-id 1747153578 | jq '{id, name, size}'

grep 'BOOKS TREATED' /box/rare_books_conservation/treatment_logs/humidity_log_q3_2025.txt /box/rare_books_conservation/treatment_logs/humidity_log_q4_2025.txt

box list-collection-items --collection-id "$(box list-all-collections | jq -r '.entries[0].id')"

box create-comment --item '{"type":"file","id":"1701916585"}' --message "Audit initiated by Admin User on $(date -u +%Y-%m-%d)."

box list-file-comments --file-id 1701916585 | jq -r '.entries[] | "\(.id) \(.message)"'

# 23 books in Q3 and 17 in Q4.
box update-comment --comment-id 7404947855 --message 'Budget approved - Q3+Q4 aggregated total: 40 books'

box remove-comment --comment-id 2912801714

# The summary with Q3 and Q4 filled in: 19 + 21 + 23 + 17 = 80 books.
sed -e 's/^Q3 2025: .*/Q3 2025: 23 books treated/' -e 's/^Q4 2025: .*/Q4 2025: 17 books treated/' -e 's/^TOTAL YTD: .*/TOTAL YTD: 80 books (through Q4)/' /box/rare_books_conservation/annual_summary_2025.txt > /workspace/annual_summary_2025.txt; cat /workspace/annual_summary_2025.txt

cp /workspace/annual_summary_2025.txt /box/rare_books_conservation/annual_summary_2025.txt

box list-all-box-hubs | jq -r '.entries[] | "\(.id) \(.title)"'

box update-box-hub-information-by-id --hub-id 777777 --description 'Rare book conservation documentation - Last audit: Q4 2025.'

box delete-folder --folder-id 7983826892 --recursive true
