# The conversations mentioning "cultures", then the ages of the oldest
# participants: Lianying Wang and Aurélia Silva are both 79, and the tie
# goes to the first name last alphabetically.
chats search --query cultures

chats read-conversation --conversation-id 39d1ae13fa2046c49b9b909d036a2d02 --limit 1

contacts search-contacts --query 'Lianying Wang'

contacts search-contacts --query 'Aurélia Silva'

complete-task --answer Lianying
