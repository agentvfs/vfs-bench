#!/usr/bin/env bash
# Upstream's reference trajectory (data.parquet row 7), each
# call as the CLI that makes it. Its ids are the session's own, which
# the seed makes the same each time; calls the client never sent to a
# server (an unknown tool, a malformed call) are left out.
light-talk get-uid-from-name --name 'Deborah Collins'
light-talk delete-chat-history --uid user_gaEhmBck8px83KgxQi6hd7
