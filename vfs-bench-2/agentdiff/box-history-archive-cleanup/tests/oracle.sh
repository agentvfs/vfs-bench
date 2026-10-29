box search-for-content --query history --type folder | jq -r '.entries[] | "\(.id) \(.name) in \(.parent.name)"'

box list-items-in-folder --folder-id 1660804823 | jq -r '.entries[] | "\(.id) \(.type) \(.name)"'

# Put BA inside Buenos Aires, as Legacy_Materials.
box update-folder --folder-id 2228309175 --parent '{"id":"1206853609"}' --name Legacy_Materials | jq -c '{id, name, parent: .parent.name}'

box list-items-in-folder --folder-id 2113564020 | jq -r '.entries[] | "\(.id) \(.type) \(.name)"'

box update-file --file-id 2797160615 --parent '{"id":"7905906319"}' | jq -c '{name, parent: .parent.name}'

cleanup=$(box create-folder --name Archive_Cleanup_2026 --parent '{"id":"1660804823"}' | jq -r .id); box create-folder --name Duplicates_Review --parent "{\"id\":\"$cleanup\"}" | jq -c '{id, name, parent: .parent.name}'

# The duplicates' tasks; the obsolete and outdated ones go.
for q in '(1)' backup copy; do box search-for-content --query "$q" --type file | jq -r '.entries[].id'; done | while read -r f; do box list-tasks-on-file --file-id "$f" | jq -r '.entries[] | "\(.id) \(.item.id) \(.message)"'; done

box remove-task --task-id 1751119378; box remove-task --task-id 1884936347; box remove-task --task-id 1177785842; box remove-task --task-id 3292462467

box list-all-box-hubs | jq -r '.entries[] | "\(.id) \(.title)"'
