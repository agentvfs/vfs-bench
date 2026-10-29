# Upstream's reference_solution, through the CLI: OCR the bulletins (the
# service returns both, combined), then find the Department of the Army
# column of Table 3 in each: FY1940 from April 1948, FY1947 from December
# 1952, which revises it.
ls -R /workspace

ocr-t59 ocr-extract-text --image-path /workspace/fixtures/pdf/treasury_bulletin_1948_04.pdf > /workspace/ocr.json
jq -r .text /workspace/ocr.json > /workspace/ocr.txt
wc -c /workspace/ocr.txt

grep -n -e '^--- Document' -e 'Table 3.- Expenditures for National Defense' /workspace/ocr.txt

grep -n -A14 'Table 3.- Expenditures for National Defense' /workspace/ocr.txt | grep -e 'Fiscal year' -e '| 1940 |' -e '| 1947 |'
