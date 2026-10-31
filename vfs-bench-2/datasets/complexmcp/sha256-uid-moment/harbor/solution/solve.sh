#!/usr/bin/env bash
# Upstream's reference trajectory (data.parquet row 20), each
# call as the CLI that makes it. Its ids are the session's own, which
# the seed makes the same each time; calls the client never sent to a
# server (an unknown tool, a malformed call) are left out.
light-talk get-myuid
crypto-server sha256 --text user_VffA2PHphcZfATBu5p6hMR
light-talk post-moment --content 52b9433ce4e5207b39ea434fcedbeb2435a9e7502db37940412d3ff9b169a159
light-talk ask-for-privilege
light-talk post-moment --content 52b9433ce4e5207b39ea434fcedbeb2435a9e7502db37940412d3ff9b169a159
