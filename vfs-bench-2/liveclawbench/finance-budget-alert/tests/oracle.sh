# Upstream's solution/solve.sh, through the CLIs: read March's department
# records, then mail upstream's alert to the manager of each department over
# budget (Engineering, Marketing) or with a negative expense (Sales).
finance login --username admin --password admin123

finance list-departments --month 2026-03

email user-login --username peter --password password123

email create-or-send-an-email --send-now true --recipient eng.manager@example.com --subject 'Budget Alert: Engineering Department Over Budget - March 2026' --body "$(printf 'Dear Engineering Department Manager,\n\nThis is an automated budget alert for March 2026.\n\nYour department has exceeded its budget allocation:\n- Budget: $150,000.00\n- Actual Expense: $180,000.00\n- Overrun: $30,000.00 (120.0%% utilization)\n\nPlease review your department expenses and provide an explanation for the overrun.\n\nBest regards,\nFinancial Controller')"

email create-or-send-an-email --send-now true --recipient sales.manager@example.com --subject 'Budget Alert: Sales Department Negative Expense - March 2026' --body "$(printf 'Dear Sales Department Manager,\n\nThis is an automated budget alert for March 2026.\n\nYour department has a data integrity issue:\n- Budget: $150,000.00\n- Actual Expense: -$5,000.00 (NEGATIVE)\n\nA negative actual expense amount indicates a data error that needs immediate correction.\n\nPlease review and correct your department expense records.\n\nBest regards,\nFinancial Controller')"

email create-or-send-an-email --send-now true --recipient marketing.manager@example.com --subject 'Budget Alert: Marketing Department Over Budget - March 2026' --body "$(printf 'Dear Marketing Department Manager,\n\nThis is an automated budget alert for March 2026.\n\nYour department has exceeded its budget allocation:\n- Budget: $150,000.00\n- Actual Expense: $200,000.00\n- Overrun: $50,000.00 (133.3%% utilization)\n\nPlease review your department expenses and provide an explanation for the overrun.\n\nBest regards,\nFinancial Controller')"
