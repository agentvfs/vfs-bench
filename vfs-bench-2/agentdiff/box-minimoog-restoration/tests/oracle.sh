# Find the restoration files and the project folder.
box search-for-content --query minimoog | jq -r '.entries[] | "\(.id) \(.type) \(.name)"'

box get-folder-information --folder-id 9559162103 | jq '{id, name, description, item_collection}'

# Favorites holds no restoration documents.
box list-all-collections | jq -r '.entries[] | "\(.id) \(.name)"'

box list-collection-items --collection-id 926489

box create-comment --item '{"type":"file","id":"1062973727"}' --message 'C47 replaced with Nichicon 47µF/25V - oscillator section complete.'

box list-file-comments --file-id 1062973727 | jq -r '.entries[] | "\(.id) \(.message)"'

box update-comment --comment-id 2656068403 --message 'C31 verified - within spec - measurement confirmed at 0.98x nominal.'

box list-tasks-on-file --file-id 3212140342 | jq -r '.entries[] | "\(.id) \(.message)"'

# The replica's update-task cannot complete a task, and nothing grades the
# resonance one, so only the cutoff task changes.
box update-task --task-id 8610023888 --message 'Cutoff tracking verified ±3 cents across 5 octaves - exceeds spec.'

box update-file --file-id 2666248889 --tags restoration-complete --fields name,tags

box create-box-hub --title 'Synth Restoration Archive'
