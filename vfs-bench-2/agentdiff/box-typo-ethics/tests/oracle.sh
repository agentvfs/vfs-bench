# The notes are in history/readings/ethics.
box search-for-content --query ethics --type folder | jq -r '.entries[] | "\(.id) \(.name) in \(.parent.name)"'

box list-items-in-folder --folder-id 3298967046 | jq -r '.entries[] | "\(.id) \(.name)"'

# Fix the misspelled names.
box update-file --file-id 6478815895 --name 'moral judgement in history.md' | jq -r .name
box update-file --file-id 2228856784 --name 'moral judgement in history.docx' | jq -r .name
box update-file --file-id 1956298215 --name 'moral judgement in history.pdf' | jq -r .name
box update-file --file-id 8847291035 --name 'philosophy of science.md' | jq -r .name
box update-file --file-id 9958302146 --name 'research ethics guidelines.txt' | jq -r .name
