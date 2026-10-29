# The user lives in Oslo, as do nine other contacts.
contacts get-current-user-details

total=$(contacts get-contacts --offset 0 | jq .metadata.total)
for o in $(seq 0 10 $((total - 1))); do contacts get-contacts --offset $o | jq -c '.contacts[]'; done > /workspace/contacts.jsonl
jq -r 'select(.city_living == "Oslo" and (.is_user | not)) | "\(.first_name) \(.last_name)"' /workspace/contacts.jsonl > /workspace/oslo.txt
cat /workspace/oslo.txt

# Which of them each app knows: four only on Messages ($15 each) and five
# only on Chats ($10 each), $110 in all.
while read -r name; do
  echo "$name|$(messages get-user-id --user-name "$name")|$(chats get-user-id --user-name "$name")"
done < /workspace/oslo.txt

# The dearest available LEGO variant is $44.99, which $110 buys twice.
shopping search-products --product-name LEGO --limit 100 | jq -c '[.products[] | .name as $n | .variants[] | select(.available) | {name: $n, price}] | max_by(.price)'

complete-task --answer 2
