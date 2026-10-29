# Find the sighting report and read it.
box search-for-content --query sighting --type file | jq -r '.entries[] | "\(.id) \(.parent.name)/\(.name)"'

cat /box/cryptozoology_raw/pacific_northwest_sighting_march2025.txt

# It mentions photographic evidence, so it is verified. Make the folders,
# then move and tag the report, and note the review.
root=$(box create-folder --name Expeditions_2025 --parent '{"id":"0"}' | jq -r .id); sightings=$(box create-folder --name Cryptid_Sightings --parent "{\"id\":\"$root\"}" | jq -r .id); echo "$root $sightings"

box update-file --file-id 3302188295 --parent "{\"id\":\"$sightings\"}" --tags verified

box create-comment --item '{"type":"file","id":"3302188295"}' --message "Reviewed $(date -u +%Y-%m-%d): Sasquatch Survey NW-7 report mentions photographic evidence; tagged verified."

# The original folder still holds a backup copy of the report.
box list-items-in-folder --folder-id 4313494130 | jq -r '.entries[] | "\(.id) \(.name)"'

box delete-file --file-id 1891733744

box update-folder --folder-id 4313494130 --name cryptozoology_raw_archived

hub=$(box create-box-hub --title '2025 Field Research Index' | jq -r .id); box manage-box-hub-items --hub-id "$hub" --operations "[{\"action\":\"add\",\"item\":{\"type\":\"folder\",\"id\":\"$root\"}}]"
