# Upstream's solution/solve.sh, through the CLI: read the three quotes, and
# accept AsterByte's (NorthPeak's is cheaper but six weeks out of stock,
# LatticePro's the dearest) with upstream's reply.
email user-login --username peter --password password123

email list-emails --folder inbox

email create-or-send-an-email --send-now true --recipient sales@asterbyte.io --subject 'Re: Procurement RFQ -- 24 x LaptopX1' --body "$(printf 'Hi AsterByte,\n\nThanks for the quote. We would like to proceed with your offer at USD 1180/unit, 5 business-day delivery. Please send the PO confirmation and we will confirm the order on our side.\n\nBest,\nPeter')"
