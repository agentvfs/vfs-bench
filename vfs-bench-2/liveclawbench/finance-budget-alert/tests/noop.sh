# Reads March's records and the inbox and sends nothing; must fail.
finance login --username admin --password admin123

finance list-departments --month 2026-03

email user-login --username peter --password password123

email list-emails --folder inbox
