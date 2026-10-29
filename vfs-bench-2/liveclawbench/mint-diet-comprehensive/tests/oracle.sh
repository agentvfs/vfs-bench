# Upstream's solution/solve.sh, through the CLI: log today's seven foods from
# the catalog, which has white rice as 白米饭 and one banana as 120 g; then
# make next week's (Monday to Sunday) active "Clean Eating Week" plan at
# 1800 kcal, add Monday's and Tuesday's dishes, and set its notes.
add() { mint-diet create-food-entry --date "$(date +%F)" --slot "$1" --food-catalog-id "$(mint-diet search-food-catalog --q "$2" | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"][0]["id"])')" --food-name "$3" --quantity-value "$4" --quantity-unit "$5"; }
add breakfast oatmeal oatmeal 250 g
add breakfast banana banana 120 g
add lunch 'chicken breast' 'chicken breast' 200 g
add lunch 白米饭 'white rice' 300 g
add dinner salmon salmon 150 g
add dinner broccoli broccoli 100 g
add snacks milk milk 240 ml

mint-diet get-daily-log-with-entries --date "$(date +%F)"

monday=$(date -d "+$((8 - $(date +%u))) days" +%F)
tuesday=$(date -d "+$((9 - $(date +%u))) days" +%F)
sunday=$(date -d "+$((14 - $(date +%u))) days" +%F)
plan=$(mint-diet create-new-meal-plan --title 'Clean Eating Week' --start-date "$monday" --end-date "$sunday" --status active --target-calories-kcal 1800 | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["id"])')
mint-diet create-plan-item --planId "$plan" --plan-date "$monday" --meal-slot breakfast --dish-name 'Oatmeal with banana'
mint-diet create-plan-item --planId "$plan" --plan-date "$monday" --meal-slot lunch --dish-name 'Chicken breast with rice'
mint-diet create-plan-item --planId "$plan" --plan-date "$monday" --meal-slot dinner --dish-name 'Salmon with broccoli'
mint-diet create-plan-item --planId "$plan" --plan-date "$tuesday" --meal-slot breakfast --dish-name 'Scrambled eggs with whole wheat toast'
mint-diet create-plan-item --planId "$plan" --plan-date "$tuesday" --meal-slot lunch --dish-name 'Tuna salad'
mint-diet create-plan-item --planId "$plan" --plan-date "$tuesday" --meal-slot dinner --dish-name 'Stir-fried tofu with vegetables'
mint-diet update-meal-plan --planId "$plan" --title 'Clean Eating Week' --start-date "$monday" --end-date "$sunday" --status active --target-calories-kcal 1800 --notes 'Focus on lean protein and vegetables — no fried foods.'
