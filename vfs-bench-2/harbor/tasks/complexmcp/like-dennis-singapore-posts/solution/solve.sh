#!/usr/bin/env bash
# Upstream's reference trajectory (data.parquet row 11), each
# call as the CLI that makes it. Its ids are the session's own, which
# the seed makes the same each time; calls the client never sent to a
# server (an unknown tool, a malformed call) are left out.
light-talk get-uid-from-name --name Dennis
light-talk get-all-contacts
light-talk get-all-moments --uid user_Rx3PTxr7hZyNQC8rTfec3n
light-talk get-myuid
light-talk like-moment --moid mo_wZ9xYbUktSeYuVE7KRA2Xm --uid user_Rx3PTxr7hZyNQC8rTfec3n
light-talk like-moment --moid mo_wZ9xYbUktSeYuVE7KRA2Xm --uid user_Rx3PTxr7hZyNQC8rTfec3n
