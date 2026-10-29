# Find the Google earnings report and check its size.
box search-for-content --query goog-10-q-q2-2025.pdf --type file | jq -r '.entries[] | "\(.id) \(.parent.name)/\(.name)"'

box get-file-information --file-id 2748861636 --fields name,size

# 676600 bytes is not over 1 MB (1048576 bytes).
box update-file --file-id 2748861636 --tags standard_audit --fields tags

hub=$(box create-box-hub --title 'Q2 Financial Review' | jq -r .id); echo "$hub"

box search-for-content --query fomc --type file | jq -r '.entries[] | "\(.id) \(.name)"'

ops=$(box search-for-content --query fomc --type file | jq -c '[.entries[] | select(.name | test("fomc"; "i")) | {action: "add", item: {type: "file", id}}]'); box manage-box-hub-items --hub-id "$hub" --operations "$ops"

# There is no Analysis_2026 folder yet.
box search-for-content --query Analysis_2026 --type folder | jq .total_count

box create-folder --name Analysis_2026 --parent '{"id":"0"}' | jq -r .id

echo 'Audit complete. Google report size: 676600 bytes.' > /box/Analysis_2026/audit_summary.txt

box create-comment --item '{"type":"file","id":"2748861636"}' --message 'Audit status: Tagged based on size (676600b).'
