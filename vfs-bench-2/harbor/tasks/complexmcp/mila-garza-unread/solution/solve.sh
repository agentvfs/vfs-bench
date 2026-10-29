#!/usr/bin/env bash
# Upstream's reference trajectory (data.parquet row 3), each
# call as the CLI that makes it. Its ids are the session's own, which
# the seed makes the same each time; calls the client never sent to a
# server (an unknown tool, a malformed call) are left out.
light-talk get-uid-from-name --name 'Mila Garza'
light-talk get-chat-history --uid user_FMTR7SfPAv5q77kpZbaL8N
light-talk mark-as-unread --uid user_FMTR7SfPAv5q77kpZbaL8N
