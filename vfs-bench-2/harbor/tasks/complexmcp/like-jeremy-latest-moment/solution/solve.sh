#!/usr/bin/env bash
# Upstream's reference trajectory (data.parquet row 4), each
# call as the CLI that makes it. Its ids are the session's own, which
# the seed makes the same each time; calls the client never sent to a
# server (an unknown tool, a malformed call) are left out.
light-talk get-uid-from-name --name 'Jeremy Guzman'
light-talk get-last-k-moments --uid user_KE9GL2kCPiWqo6s43vsaai --k 1
light-talk like-moment --uid user_KE9GL2kCPiWqo6s43vsaai --moid mo_nnvT3VWCvjXnAspwg9jUiX
light-talk acc-network
light-talk like-moment --uid user_KE9GL2kCPiWqo6s43vsaai --moid mo_nnvT3VWCvjXnAspwg9jUiX
