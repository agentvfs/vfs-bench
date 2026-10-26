# Upstream's solution/solve.sh, through the CLIs: log in to both apps, read
# the inbox, and create the two invoices the vendor emails give.
finance login --username admin --password admin123

email user-login --username peter --password password123

email list-emails --folder inbox

finance create-invoice --vendor-id 1 --invoice-number INV-2026-010 --invoice-date 2026-03-01 --items '[{"description":"Software License Renewal","category_code":"5300","amount":15000},{"description":"Technical Support","category_code":"5400","amount":5000}]'

finance create-invoice --vendor-id 3 --invoice-number INV-2026-011 --invoice-date 2026-03-05 --items '[{"description":"System Integration","category_code":"5400","amount":8000},{"description":"Training Services","category_code":"5400","amount":3500}]'
