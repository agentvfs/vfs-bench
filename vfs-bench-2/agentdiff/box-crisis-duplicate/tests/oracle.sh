# Two copies of the notes: one in history, one misfiled in the root.
box search-for-content --query crisis --type file | jq -r '.entries[] | "\(.id) \(.parent.name)/\(.name)"'

box delete-file --file-id 9979104500

grep -c Argentina '/box/personal_final/history/2001 crisis notes.txt'

box update-file --file-id 5696874158 --tags Latin_America --fields name,tags
