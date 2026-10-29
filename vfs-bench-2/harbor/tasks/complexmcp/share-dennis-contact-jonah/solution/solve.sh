#!/usr/bin/env bash
# Upstream's reference trajectory (data.parquet row 6), each
# call as the CLI that makes it. Its ids are the session's own, which
# the seed makes the same each time; calls the client never sent to a
# server (an unknown tool, a malformed call) are left out.
light-talk get-uid-from-name --name 'Jonah Palmer'
light-talk get-uid-from-name --name Dennis
light-talk get-all-contacts
light-talk edit-remark --uid user_kZcEES3MgRBU9d3Qa3e9U4 --remark Boyfriend
light-talk acc-network
light-talk edit-remark --uid user_kZcEES3MgRBU9d3Qa3e9U4 --remark Boyfriend
light-talk get-shared-url-of-contact --uid user_kZcEES3MgRBU9d3Qa3e9U4
light-talk send-message --content 'Here is the contact sharing link for Dennis: light://contact.talk.so?uid=user_kZcEES3MgRBU9d3Qa3e9U4' --uid user_mUfvCbeW7MLgrLhJwpZTKL
