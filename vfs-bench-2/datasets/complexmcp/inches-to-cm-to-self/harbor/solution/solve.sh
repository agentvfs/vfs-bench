#!/usr/bin/env bash
# Upstream's reference trajectory (data.parquet row 14), each
# call as the CLI that makes it. Its ids are the session's own, which
# the seed makes the same each time; calls the client never sent to a
# server (an unknown tool, a malformed call) are left out.
unit-server convert-length --from-unit inch --to-unit centimeter --value 16.8
light-talk get-myuid
light-talk send-message --content 42.672 --uid user_e3HEjgt6S3EW3DfZEbp2oh
