# Bronwen Pritchard lives in Cardiff.
contacts search-contacts --query Bronwen

rent-a-flat search-apartments --location Cardiff > /workspace/cardiff.json
jq -c '.data[] | [.name, .zip_code, .price]' /workspace/cardiff.json

# Each listed zip code's crime rates: CF10 2AH has the lowest violent crime
# (3.32), and its one listing costs 1000.
jq -r '.data[].zip_code' /workspace/cardiff.json | sort -u | while read -r zip; do
  echo "$zip $(city get-crime-rate --zip-code "$zip" | jq -c .data)"
done

complete-task --answer 1000
