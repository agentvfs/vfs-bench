# Find the misspelled reading under digital humanities, then rename it.
box search-for-content --query 'approaches to hist research' --type file

box get-file-information --file-id 3266469077

box update-file --file-id 3266469077 --name 'computational approaches to hist research.md'
