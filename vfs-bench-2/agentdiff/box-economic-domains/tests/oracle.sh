# Find the CSVs under investments/macroeconomics and read each one's header
# and first row.
ls /box

box list-items-in-folder --folder-id 1973339758 | jq -r '.entries[] | "\(.id) \(.type) \(.name)"'

head -n 2 /box/investments/macroeconomics/*.csv

# The census CSVs one folder down are not time series.
for f in /box/investments/macroeconomics/2018-census-totals-by-topic-national-highlights-csv/*.csv; do head -n 1 "$f"; done | grep -c Series_reference

# Three domains, one file each: BDCQ, CPIM and TPTA.
top=$(box create-folder --name Economic_Domains --parent '{"id":"0"}' | jq -r .id); echo "$top"

bdcq=$(box create-folder --name Domain_BDCQ --parent "{\"id\":\"$top\"}" | jq -r .id); box update-file --file-id 1107398791 --parent "{\"id\":\"$bdcq\"}" --tags domain:BDCQ | jq -c '{name, parent: .parent.name, tags}'

cpim=$(box create-folder --name Domain_CPIM --parent "{\"id\":\"$top\"}" | jq -r .id); box update-file --file-id 1490177849 --parent "{\"id\":\"$cpim\"}" --tags domain:CPIM | jq -c '{name, parent: .parent.name, tags}'

tpta=$(box create-folder --name Domain_TPTA --parent "{\"id\":\"$top\"}" | jq -r .id); box update-file --file-id 1421498350 --parent "{\"id\":\"$tpta\"}" --tags domain:TPTA | jq -c '{name, parent: .parent.name, tags}'

# No domain has two files, so the hub gets no folders.
box create-box-hub --title 'Economic Data Index'

printf 'BDCQ: 1 file(s) | Hub: NO\nCPIM: 1 file(s) | Hub: NO\nTPTA: 1 file(s) | Hub: NO\n' > /box/Economic_Domains/domain_manifest.txt

cat /box/Economic_Domains/domain_manifest.txt
