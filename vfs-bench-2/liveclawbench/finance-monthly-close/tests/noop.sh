# Reads the accounts and pending transactions and changes nothing; must fail.
finance login --username admin --password admin123

finance list-accounts

finance list-transactions --status pending
