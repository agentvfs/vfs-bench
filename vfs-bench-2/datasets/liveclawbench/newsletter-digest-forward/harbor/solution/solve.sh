#!/usr/bin/env bash
# Upstream's solution, on Mirage's gws fake (vfs-bench-2, rule A): it reads
# the mailbox at /gmail and sends with the gws CLI, where upstream's logs in
# to the email mock and posts to its REST API.
set -euo pipefail

# The three lead updates are in unread newsletters; the mascot giveaway is too.
for UPDATE in "VectorDB Cloud row-level ACLs" "OpenBrowse persistent sessions" "NovaStack Series A"; do
  grep -l "$UPDATE" /gmail/UNREAD/*/*.gmail.json > /dev/null
done

# Write the digest note
mkdir -p /workspace/notes
cat > /workspace/notes/newsletter-digest.md <<'NOTE'
# Newsletter digest -- 2026-04-03

- VectorDB Cloud row-level ACLs
- OpenBrowse persistent sessions
- NovaStack Series A
NOTE

# Send the digest email
gws gmail send --to research@work.mosi.inc \
  --subject "Newsletter digest -- 2026-04-03" \
  --body "Top three updates this cycle:

  - VectorDB Cloud row-level ACLs
  - OpenBrowse persistent sessions
  - NovaStack Series A
" > /dev/null
echo "Oracle: digest file + email sent"
