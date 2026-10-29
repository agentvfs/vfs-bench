# Upstream's solution/solve.sh, through the CLI: read the requests in #pets
# (channel 2) and #space (3), acquire the Cute Cats (pack 1) and Space
# Adventure (pack 2) packs, send each channel the first sticker of its pack
# (Sleepy Cat, Rocket), and file every cat sticker as a favorite.
chat list-channels

chat get-messages-in-a-channel --id 2

chat get-messages-in-a-channel --id 3

chat list-sticker-packs

chat acquire-a-sticker-pack --id 1

chat acquire-a-sticker-pack --id 2

cat=$(chat list-stickers | python3 -c 'import json,sys; print([s["id"] for s in json.load(sys.stdin)["stickers"] if s["pack_id"] == 1][0])')
chat send-a-message --id 2 --body "{\"message_kind\": \"sticker\", \"sticker_id\": $cat}"

rocket=$(chat list-stickers | python3 -c 'import json,sys; print([s["id"] for s in json.load(sys.stdin)["stickers"] if s["pack_id"] == 2][0])')
chat send-a-message --id 3 --body "{\"message_kind\": \"sticker\", \"sticker_id\": $rocket}"

for id in $(chat list-stickers | python3 -c 'import json,sys; print(" ".join(str(s["id"]) for s in json.load(sys.stdin)["stickers"] if s["pack_id"] == 1))'); do chat update-a-sticker --id "$id" --body '{"category": "favorite"}'; done
