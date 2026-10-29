hub=$(box create-box-hub --title 'Demographics 2025' | jq -r .id); echo "$hub"

# The census folder is the one with many CSVs.
box list-items-in-folder --folder-id 1973339758 | jq -r '.entries[] | "\(.id) \(.type) \(.name)"'

box list-items-in-folder --folder-id 9782984299 | jq .total_count

box update-folder --folder-id 9782984299 --name Census_2018_Master | jq -c '{id, name}'

box create-folder --name National_Highlights --parent '{"id":"9782984299"}' | jq -c '{id, name}'

box search-for-content --query transport-april-2025-csv.csv --type file | jq -r '.entries[] | "\(.id) \(.parent.name)/\(.name)"'

head -n 2 /box/investments/macroeconomics/transport-april-2025-csv.csv

box update-file --file-id 1421498350 --parent '{"id":"9782984299"}' | jq -c '{name, parent: .parent.name}'

box create-comment --item '{"type":"file","id":"1421498350"}' --message 'Transport series TPTA.S22IA included for cross-reference.'

# No census file has "population" in its name, so nothing moves.
box list-items-in-folder --folder-id 9782984299 | jq -r '.entries[] | select(.name | test("population"; "i")) | .name'

echo 'Consolidated: Census 2018 + Transport 2025.' > /box/investments/macroeconomics/Census_2018_Master/hub_manifest.txt

box update-box-hub-information-by-id --hub-id "$hub" --description 'Unified demographic and transport datasets.'
