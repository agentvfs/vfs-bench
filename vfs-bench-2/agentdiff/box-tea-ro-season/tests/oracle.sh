# The seasonal materials hub already exists.
box list-all-box-hubs | jq -r '.entries[] | "\(.id) \(.title)"'

box search-for-content --query chado --type folder | jq -r '.entries[] | "\(.id) \(.name)"'

box list-items-in-folder --folder-id 4324248428 | jq -r '.entries[] | "\(.id) \(.name)"'

# The guide's status is CURRENT; the draft is the superseded one.
head -n 8 /box/chado_tea_ceremony/winter_preparation_guide.txt; head -n 4 /box/chado_tea_ceremony/winter_prep_DRAFT_old.txt

box update-file --file-id 3180616460 --tags winter_season --description 'Ro season preparation - 炉 (November-April)' --fields name,tags,description

box create-comment --item '{"type":"file","id":"3180616460"}' --message 'Ready for Ro season (炉) - charcoal placement verified.'

box create-comment --item '{"type":"file","id":"3309661031"}' --message 'Utensils require cleaning before Hatsugama ceremony.'

box delete-file --file-id 1018029878

box manage-box-hub-items --hub-id 888888 --operations '[{"action":"add","item":{"type":"file","id":"3180616460"}}]'
