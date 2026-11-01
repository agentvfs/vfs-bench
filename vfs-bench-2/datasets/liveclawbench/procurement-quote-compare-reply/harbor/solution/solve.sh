#!/usr/bin/env bash
# Upstream's solution, on Mirage's gws fake (vfs-bench-2, rule A): it finds
# the winning quote at /gmail and replies to it with the gws CLI, where
# upstream's logs in to the email mock and posts to its REST API.
set -euo pipefail

# AsterByte's quote (USD 1180/unit, 5 business days) is the best under the
# USD 1200 cap: NorthPeak's is cheaper but takes 6 weeks.
QUOTE=$(grep -l "sales@asterbyte.io" /gmail/INBOX/*/*.gmail.json)
ID=$(basename "$QUOTE" .gmail.json | sed 's/.*__//')

# Reply with the acceptance to AsterByte (winner)
gws gmail reply --message-id "$ID" --body "Hi AsterByte,

Thanks for the quote. We would like to proceed with your offer at USD 1180/unit, 5 business-day delivery. Please send the PO confirmation and we will confirm the order on our side.

Best,
Peter" > /dev/null
echo "Oracle: acceptance email sent to sales@asterbyte.io"
