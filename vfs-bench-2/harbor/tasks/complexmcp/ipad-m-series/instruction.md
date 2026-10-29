Please help me buy an iPad with an M-series chip.
Once you've completed the task—or if you believe it's unsolvable—output [END] at the end.

## Tools

Each tool is a shell command, `<server> <tool> [--flag value ...]`, whose output is the tool's reply; `<server> <tool> --help` says more.

### math-server

- `math-server add --a <number> --b <number>`: Adds a and b together.
- `math-server sub --a <number> --b <number>`: Subtracts b from a.
- `math-server mul --a <number> --b <number>`: Multiplies two numbers together.
- `math-server div --a <number> --b <number>`: Divides a by b.
- `math-server pow --a <number> --b <number>`: Raises a to the power of b.
- `math-server sqrt --a <number>`: Calculates the square root of a.
- `math-server abs-val --a <number>`: Returns the absolute value of a.
- `math-server mod --a <number> --b <number>`: Finds the remainder of a divided by b.
- `math-server floor-div --a <number> --b <number>`: Performs floor division of a by b.
- `math-server max-val --a <number> --b <number>`: Returns the maximum of a and b.
- `math-server min-val --a <number> --b <number>`: Returns the minimum of a and b.
- `math-server round-val --a <number> [--ndigits <integer>]`: Rounds a to the given number of decimal places.
- `math-server log --a <number> [--base <number>]`: Calculates the logarithm of a with the given base.
- `math-server exp --a <number>`: Calculates e raised to the power of a.
- `math-server sin --a <number>`: Calculates the sine of a (in radians).
- `math-server cos --a <number>`: Calculates the cosine of a (in radians).
- `math-server tan --a <number>`: Calculates the tangent of a (in radians).
- `math-server asin --a <number>`: Calculates the arcsine of a.
- `math-server acos --a <number>`: Calculates the arccosine of a.
- `math-server atan --a <number>`: Calculates the arctangent of a.
- `math-server sinh --a <number>`: Calculates the hyperbolic sine of a.
- `math-server cosh --a <number>`: Calculates the hyperbolic cosine of a.
- `math-server tanh --a <number>`: Calculates the hyperbolic tangent of a.
- `math-server factorial --a <integer>`: Calculates the factorial of a.
- `math-server gcd --a <integer> --b <integer>`: Calculates the greatest common divisor of a and b.
- `math-server lcm --a <integer> --b <integer>`: Calculates the least common multiple of a and b.
- `math-server deg-to-rad --a <number>`: Converts degrees to radians.
- `math-server rad-to-deg --a <number>`: Converts radians to degrees.
- `math-server is-even --a <integer>`: Checks if a number is even.
- `math-server is-odd --a <integer>`: Checks if a number is odd.
- `math-server is-prime --a <integer>`: Checks if a number is prime.
- `math-server nth-fibonacci --n <integer>`: Calculates the nth Fibonacci number.
- `math-server sum-of-list [--numbers <value> ...]`: Calculates the sum of a list of numbers.
- `math-server product-of-list [--numbers <value> ...]`: Calculates the product of a list of numbers.
- `math-server mean [--numbers <value> ...]`: Calculates the mean of a list of numbers.
- `math-server median [--numbers <value> ...]`: Calculates the median of a list of numbers.
- `math-server mode [--numbers <value> ...]`: Calculates the mode of a list of numbers.
- `math-server variance [--numbers <value> ...]`: Calculates the variance of a list of numbers.
- `math-server standard-deviation [--numbers <value> ...]`: Calculates the standard deviation of a list of numbers.
- `math-server clamp --value <number> --min-val <number> --max-val <number>`: Clamps a value between min_val and max_val.
- `math-server hypot --a <number> --b <number>`: Calculates the hypotenuse of a right triangle with sides a and b.
- `math-server cbrt --a <number>`: Calculates the cube root of a.

### unit-server

- `unit-server convert-temperature --value <number> --from-unit <string> --to-unit <string>`: Convert temperature between units.
- `unit-server convert-angle --value <number> --from-unit <string> --to-unit <string>`: Convert angle between units.
- `unit-server convert-length --value <number> --from-unit <string> --to-unit <string>`: Convert length between units.
- `unit-server convert-energy --value <number> --from-unit <string> --to-unit <string>`: Convert energy between units.
- `unit-server convert-force --value <number> --from-unit <string> --to-unit <string>`: Convert force between units.
- `unit-server convert-pressure --value <number> --from-unit <string> --to-unit <string>`: Convert pressure between units.
- `unit-server convert-power --value <number> --from-unit <string> --to-unit <string>`: Convert power between units.
- `unit-server convert-speed --value <number> --from-unit <string> --to-unit <string>`: Convert speed between units.
- `unit-server convert-area --value <number> --from-unit <string> --to-unit <string>`: Convert area between units.
- `unit-server convert-mass --value <number> --from-unit <string> --to-unit <string>`: Convert weight between units.
- `unit-server convert-volume --value <number> --from-unit <string> --to-unit <string>`: Convert volume between units.
- `unit-server convert-computer-data --value <number> --from-unit <string> --to-unit <string>`: Convert computer storage between units.
- `unit-server convert-density --value <number> --from-unit <string> --to-unit <string>`: Convert density between units.
- `unit-server convert-time --value <number> --from-unit <string> --to-unit <string>`: Convert time between units.
- `unit-server convert-batch --requests <JSON>`: Perform multiple unit conversions in a single batch request. Each request in the batch should contain: - value: The numeric value to convert - from_unit: Source unit for conversion - to_unit: Target unit for conversion - conversion_type: Type of conversion (temperature, length, mass, etc.) - request_id: Optional identifier for tracking individual requests Returns a structured response with individual results for each conversion, including success/failure status and either converted values or error messages.
- `unit-server list-supported-units [--unit-type <string>]`: List all supported units for each conversion type or for a specific type.

### osint-server

- `osint-server whois-lookup --target <string>`
- `osint-server nmap-scan --target <string>`
- `osint-server dnsrecon-lookup --target <string>`
- `osint-server dnstwist-lookup --domain <string>`
- `osint-server dig-lookup --target <string>`
- `osint-server host-lookup --target <string>`
- `osint-server osint-overview --target <string>`

### time-server

- `time-server days-diff --t1 <string> --t2 <string>`: Calculate the day difference between two dates in "YYYY-MM-DD" format. Args: t1: Start date in "YYYY-MM-DD". t2: End date in "YYYY-MM-DD". Returns: A dict containing status and the day difference (t2 - t1) in days.
- `time-server date-to-weekday --d <string> [--locale <string>] [--short <boolean>]`: Convert a date string into a weekday name. Notes: - This function uses English weekday names only (locale parameter is reserved for future extension). - Input format: "YYYY-MM-DD". Args: d: Date string in "YYYY-MM-DD". locale: Reserved; currently only "en" is supported. short: If True, return abbreviated weekday (e.g., "Mon"); otherwise full name. Returns: A dict containing status and weekday name.
- `time-server iso-seconds-diff --t1 <string> --t2 <string>`: Calculate the seconds difference between two ISO-8601 datetime strings. Supported examples: - "2026-01-14T12:30:00" - "2026-01-14T12:30:00Z" - "2026-01-14T12:30:00+08:00" Interpretation: - If timezone info is present, it is respected. - If timezone info is absent, the datetime is treated as naive local time. Args: t1: ISO datetime string. t2: ISO datetime string. Returns: A dict containing status and the seconds difference (t2 - t1) in seconds.
- `time-server convert-time-units --value <number> --from-unit <string> --to-unit <string>`: Convert between common time units. Supported units: - "ms" (milliseconds) - "s" (seconds) - "min" (minutes) - "h" (hours) - "d" (days) - "w" (weeks) Args: value: Numeric value to convert. from_unit: Source unit. to_unit: Target unit. Returns: A dict containing status and the converted value.
- `time-server add-seconds-iso --t <string> --seconds <integer>`: Add seconds to an ISO-8601 datetime string and return an ISO string. Notes: - If input ends with "Z", it is treated as UTC. - Output uses ISO format; if timezone-aware, includes offset. Args: t: ISO datetime string. seconds: Seconds to add (can be negative). Returns: A dict containing status and the resulting ISO datetime string.

### lang-server

- `lang-server tokenize --text <string>`: Simple whitespace-and-punctuation tokenizer.
- `lang-server detokenize [--tokens <value> ...]`: Join tokens with spaces, simple heuristic.
- `lang-server normalize-whitespace --text <string>`: Collapse consecutive whitespace into a single space and trim ends. Returns a cleaned string with normalized spacing suitable for downstream NLP tasks.
- `lang-server remove-punctuation --text <string>`: Remove punctuation characters from `text`, leaving words and whitespace. Useful for simple token-counting or normalization when punctuation is not needed.
- `lang-server count-words --text <string>`: Return the number of word tokens in `text` using the server tokenizer.
- `lang-server word-freq --text <string>`: Return a frequency mapping (word -> count) for tokens in `text`. Tokens are lowercased so counts are case-insensitive.
- `lang-server sentence-split --text <string>`: Split `text` into sentences using a simple punctuation-based heuristic. Returns a list of sentence strings (may not handle all edge cases).
- `lang-server simple-summarize --text <string> [--max-sentences <integer>]`: Very small extractive summarizer by sentence length heuristic.
- `lang-server levenshtein --a <string> --b <string>`: Compute the Levenshtein edit distance between strings `a` and `b`. This implementation is memory-efficient (row-wise DP).
- `lang-server jaccard-similarity --a <string> --b <string>`: Compute Jaccard similarity between token sets of `a` and `b`. Returns a float in [0, 1], 1.0 when both inputs have identical token sets.
- `lang-server ngrams --text <string> [--n <integer>]`: Return a list of n-grams (as space-joined strings) from `text` tokens. If there are fewer than `n` tokens an empty list is returned.
- `lang-server to-lower --text <string>`: Return `text` converted to lowercase.
- `lang-server to-upper --text <string>`: Return `text` converted to uppercase.
- `lang-server title-case --text <string>`: Return `text` converted to title case.
- `lang-server snake-case --text <string>`: Convert `text` to `snake_case` by lowercasing and joining word tokens with underscores.
- `lang-server camel-case --text <string>`: Convert `text` to `camelCase` using word tokens (lower-first, capitalize-following).
- `lang-server slugify --text <string>`: Create a URL-friendly slug from `text`: lowercase, remove punctuation, replace spaces with hyphens.
- `lang-server extract-numbers --text <string>`: Extract all integers and decimal numbers from `text` and return them as floats.
- `lang-server hash-text --text <string> [--algo <string>]`: Return a hexadecimal digest of `text` using the specified hashing `algo`. The default algorithm is `sha256`.
- `lang-server base64-encode --text <string>`: Encode `text` to standard Base64 and return the ASCII string.
- `lang-server base64-decode --b64 <string>`: Decode a Base64-encoded ASCII string and return the UTF-8 text.
- `lang-server is-palindrome --text <string>`: Return True if `text` is a palindrome when lowercased and alphanumerics only. Ignores punctuation and spacing when checking the palindrome property.
- `lang-server regex-search --pattern <string> --text <string>`: Return all non-overlapping matches of `pattern` in `text` using `re.findall`.
- `lang-server replace --pattern <string> --repl <string> --text <string>`: Replace occurrences of `pattern` in `text` with `repl` using regular expressions.
- `lang-server truncate --text <string> [--length <integer>]`: Truncate `text` to `length` characters, appending ellipsis if truncated.
- `lang-server read-time-estimate --text <string> [--wpm <integer>]`: Estimate reading time in minutes for `text` assuming `wpm` words per minute.
- `lang-server remove-stopwords --text <string>`: Remove a small set of common English stopwords from `text` and return the filtered text.
- `lang-server simple-paraphrase --text <string>`: A tiny rule-based paraphrase that substitutes a few common words with synonyms. This is placeholder, rule-based, and not a replacement for a full paraphrasing model.
- `lang-server syllable-estimate --word <string>`: Estimate the number of syllables in `word` using a simple vowel-group heuristic.
- `lang-server ordinal --n <integer>`: Return the ordinal string for integer `n`, e.g. 1 -> '1st', 2 -> '2nd'.
- `lang-server count-chars --text <string>`: Return the number of characters in `text` (including whitespace).
- `lang-server template-render --template <string> --values <JSON>`: Render a simple Python `str.format` template using `values` mapping.

### crypto-server

- `crypto-server sha256 --text <string>`: Return the SHA-256 hex digest of the given `text`.
- `crypto-server sha1 --text <string>`: Return the SHA-1 hex digest of the given `text`.
- `crypto-server md5 --text <string>`: Return the MD5 hex digest of the given `text` (legacy/compatibility).
- `crypto-server hmac-sha256 --key <string> --message <string>`: Compute HMAC-SHA256 of `message` using `key`, returning a hex digest.
- `crypto-server pbkdf2-hex --password <string> --salt <string> [--iterations <integer>] [--dklen <integer>]`: Derive a key from `password` and `salt` using PBKDF2-HMAC-SHA256. Returns the derived key as a hex string.
- `crypto-server random-bytes [--n <integer>]`: Return `n` cryptographically-secure random bytes encoded as a hex string.
- `crypto-server random-hex [--nbytes <integer>]`: Return `nbytes` random bytes encoded as a hex string (alias of `random_bytes`).
- `crypto-server base64-encode --text <string>`: Encode `text` to Base64 and return the encoded string.
- `crypto-server base64-decode --b64 <string>`: Decode a Base64-encoded string and return the decoded text.
- `crypto-server xor-cipher --text <string> --key <string>`: Apply a repeating-key XOR of `text` with `key` and return hex-encoded ciphertext. Note: this is not secure encryption; provided for toy/offline uses only.
- `crypto-server xor-dec --hextext <string> --key <string>`: Decode a hex-encoded XOR ciphertext produced by `xor_cipher` using the same `key`.
- `crypto-server simple-caesar --text <string> [--shift <integer>]`: Apply a simple Caesar cipher shifting alphabetic characters by `shift` positions.
- `crypto-server rot13 --text <string>`: Return ROT13 transformation of `text` (a reversible letter substitution).
- `crypto-server timing-safe-compare --a <string> --b <string>`: Compare two strings in a timing-safe way to mitigate timing attacks.
- `crypto-server derive-key --password <string> --salt <string> [--iterations <integer>]`: Convenience wrapper returning a PBKDF2-derived key hex string for `password` and `salt`.
- `crypto-server entropy-estimate-hex --hexstr <string>`: Estimate the Shannon entropy (bits per symbol) of hex-encoded `hexstr`.
- `crypto-server uuid4`: Return a random UUID4 string.
- `crypto-server hex-to-bytes --hexstr <string>`: Convert a hex string into raw bytes.
- `crypto-server bytes-to-hex --b <string>`: Convert raw bytes to a lowercase hex string.
- `crypto-server urlsafe-b64-encode --text <string>`: Encode `text` as URL-safe Base64 string.
- `crypto-server urlsafe-b64-decode --text <string>`: Decode a URL-safe Base64 string and return the decoded text.
- `crypto-server hmac-sign-hex --key <string> --message <string>`: Return HMAC-SHA256 signature (hex) for `message` with `key`.
- `crypto-server hmac-verify-hex --key <string> --message <string> --signature <string>`: Verify that `signature` matches HMAC-SHA256(message,key) in a timing-safe way.
- `crypto-server checksum-sha256-hex --text <string>`: Alias for SHA-256 digest of `text` (hex string).
- `crypto-server random-choice --seq <value> ...`: Return a cryptographically-secure random element from `seq`.
- `crypto-server secure-token-urlsafe [--length <integer>]`: Return a URL-safe secure token with the specified `length` (approx bytes).
- `crypto-server file-digest --path <string> [--algo <string>]`: Compute the digest of a file at `path` using hash `algo` and return hex digest.
- `crypto-server xor-bytes-hex --a-hex <string> --b-hex <string>`: XOR two equal-length hex-encoded byte strings and return hex-encoded result.

### graph-server

- `graph-server bfs --adj <JSON> --start <None>`: Perform breadth-first search on `adj` from `start` and return visit order. `adj` is expected to be a mapping node -> iterable of neighbors.
- `graph-server dfs --adj <JSON> --start <None>`: Perform depth-first search on `adj` from `start` and return visit order.
- `graph-server shortest-path-dijkstra --adj <JSON> --source <None>`: Compute shortest-path distances from `source` using Dijkstra's algorithm. `adj` should map nodes to an iterable of `(neighbor, weight)` pairs. Returns a mapping node -> distance.
- `graph-server is-bipartite --adj <JSON>`: Return True if graph `adj` is bipartite (2-colorable), False otherwise.
- `graph-server connected-components --adj <JSON>`: Return a list of connected components (each a list of nodes) in `adj`.
- `graph-server topological-sort --adj <JSON>`: Return a topological ordering of `adj` if it is a DAG; raises on cycles.
- `graph-server mst-kruskal --edges <value> ... --nodes <value> ...`: Compute a Minimum Spanning Tree using Kruskal's algorithm. `edges` is a list of `(weight, u, v)` triples and `nodes` lists all nodes. Returns a list of edges included in the MST.
- `graph-server shortest-path-unweighted --adj <JSON> --source <None>`: Compute shortest path distances in an unweighted graph (BFS distances).
- `graph-server path-exists --adj <JSON> --a <None> --b <None>`: Return True if there exists a path from node `a` to node `b` in `adj`.
- `graph-server adjacency-matrix --adj <JSON> --nodes <value> ...`: Build an adjacency matrix for `nodes` from adjacency mapping `adj`. Returns a square matrix of 0/1 ints where entry [i][j] is 1 if there is an edge.
- `graph-server adjacency-list-to-matrix --adj <JSON>`: Convert adjacency list mapping to an adjacency matrix using the list of keys as nodes.
- `graph-server degree-centrality --adj <JSON>`: Return the degree (number of neighbors) for each node in `adj`.
- `graph-server is-connected --adj <JSON>`: Return True if the graph `adj` is connected (single component).
- `graph-server graph-complement --adj <JSON> --nodes <value> ...`: Return the complement graph of `adj` over the provided `nodes`. Nodes not present in `adj` are treated as having no neighbors.
- `graph-server random-erdos-renyi --n <integer> --p <number>`: Generate a random undirected Erdos-Renyi graph with `n` nodes and edge probability `p`. Returns an adjacency mapping node -> list of neighbors.

### chem-server

- `chem-server molar-mass --formula <string>`: Compute an approximate molar mass for `formula` using a small periodic table. This is a naive parser that matches element symbols followed by optional integer counts. Unknown elements contribute 0.0.
- `chem-server empirical-formula --formula <string>`: Return the empirical (reduced) formula for `formula` by dividing element counts by their GCD.
- `chem-server percent-composition --formula <string>`: Return percent by mass composition for each element in `formula`. Percentages sum to (approximately) 100 for known elements in the small periodic table.
- `chem-server balance-simple-reaction --reactants <JSON> --products <JSON>`: Placeholder reaction balancer: returns input mapping unchanged. This function is a stub for offline use and does not perform true balancing.
- `chem-server is-balanced --formula <string>`: Placeholder validator that currently always returns True for a formula's balance.
- `chem-server ph-from-concentration --h-conc <number>`: Convert hydrogen ion concentration `h_conc` (mol/L) to pH value.
- `chem-server concentration-from-ph --ph <number>`: Convert pH value back to hydrogen ion concentration (mol/L).
- `chem-server ideal-gas-pressure --n-moles <number> --temp-k <number> --volume-l <number>`: Compute pressure (in SI units of kPa equivalently via ideal gas law) for given moles, temperature, and volume. Note: this uses a simple ideal gas approximation and performs unit conversions from liters.
- `chem-server convert-moles-to-grams --moles <number> --formula <string>`: Convert an amount in `moles` of a substance with `formula` to mass in grams (approx).
- `chem-server convert-grams-to-moles --grams <number> --formula <string>`: Convert `grams` of a substance with `formula` to moles using approximate molar mass.
- `chem-server normalize-formula --formula <string>`: Return `formula` with whitespace removed for normalization.
- `chem-server element-list --formula <string>`: Return a list of element symbols present in `formula` in the order they appear.
- `chem-server combustion-products --fuel-formula <string>`: Naive estimator of complete combustion products (CO2 and H2O) from a hydrocarbon `fuel_formula`. This is a heuristic estimator that assumes integer counts and complete combustion.
- `chem-server is-organic --formula <string>`: Return True if `formula` contains carbon (simple organic check).
- `chem-server simple-smiles-validate --smiles <string>`: Very small validator for a SMILES-like string: checks balanced parentheses only.
- `chem-server mole-fraction --partial-moles <number> --total-moles <number>`: Compute a mole fraction given `partial_moles` and `total_moles` (returns 0 if total is zero).
- `chem-server clamp --value <number> --lo <number> --hi <number>`: Clamp `value` between `lo` and `hi` and return the clamped float.

### light-system

- `light-system now`: Get the current time
- `light-system health`: Check if this LightSystem is work

### light-talk

- `light-talk get-all-contacts`: Get the information of all contacts in LightTalk.
- `light-talk get-uid-from-name --name <string>`: Look up a user's unique ID (UID) by their display name in LightTalk.
- `light-talk fuzzy-search-uids-from-name --name <string>`: Perform a fuzzy (approximate) search to find user IDs (UIDs) in LightTalk based on a partial or misspelled contact name.
- `light-talk send-message --uid <string> --content <string>`: Send a message to a specific contact in LightTalk using their UID.
- `light-talk get-myuid`: Retrieve the current user's own unique ID (UID) in LightTalk.
- `light-talk get-chat-history --uid <string>`: Fetch the chat history with a specific contact in LightTalk.
- `light-talk get-contacts --page <integer>`: Retrieve a paginated list of contacts from LightTalk. Each page contains up to 10 contacts.
- `light-talk delete-chat-history --uid <string>`: Delete the entire chat history with a specific contact in LightTalk.
- `light-talk delete-message --uid <string> --mid <string>`: Delete a specific message in a chat with a contact in LightTalk.
- `light-talk block --uid <string>`: Block a contact in LightTalk by their unique ID (UID).
- `light-talk unblock --uid <string>`: Unblock a contact in LightTalk by their unique ID (UID).
- `light-talk get-contact-info --uid <string>`: Retrieve detailed information about a specific contact in LightTalk.
- `light-talk get-all-moments --uid <string>`: Fetch all public moments (posts) published by a specific contact in LightTalk.
- `light-talk get-last-k-moments --uid <string> --k <integer>`: Retrieve the most recent K moments published by a specific contact in LightTalk.
- `light-talk get-moment --uid <string> --index <integer>`: Fetch a specific moment by its index from a contact's timeline in LightTalk.
- `light-talk like-moment --uid <string> --moid <string>`: Like a specific moment posted by a contact in LightTalk.
- `light-talk unlike-moment --uid <string> --moid <string>`: Remove your like from a specific moment posted by a contact in LightTalk.
- `light-talk comment-moment --uid <string> --moid <string> --content <string>`: Post a comment on a specific moment in LightTalk.
- `light-talk comment-comment --uid <string> --moid <string> --cid <string> --content <string>`: Post a nested reply (comment on a comment) under a specific moment in LightTalk.
- `light-talk list-all-tags`: Retrieve a list of all available contact tags in LightTalk.
- `light-talk get-contacts-by-tag --tag <string>`: Find all contacts in LightTalk that are labeled with a specific tag.
- `light-talk get-contacts-by-gender --gender <string>`: Retrieve all contacts in LightTalk filtered by gender.
- `light-talk withdraw-comment-moment --uid <string> --moid <string> --my-cid <string>`: Delete (withdraw) your own comment on a moment in LightTalk.
- `light-talk withdraw-comment-comment --uid <string> --moid <string> --cid <string> --my-cid <string>`: Delete (withdraw) your own nested comment (reply to a comment) under a specific moment in LightTalk.
- `light-talk mark-as-read --uid <string>`: Mark the chat with a specific contact as read in LightTalk, clearing any unread message indicators.
- `light-talk mark-as-unread --uid <string>`: Mark the chat with a specific contact as unread in LightTalk, so it appears as having new messages.
- `light-talk get-my-moments`: Retrieve all moments (posts) that you have published in LightTalk.
- `light-talk post-moment --content <string> [--img-urls <value> ...]`: Publish a new moment (post) in LightTalk with optional images.
- `light-talk delete-moment --moid <string>`: Delete one of your own moments (posts) in LightTalk by its unique ID.
- `light-talk get-shared-url-of-moment --uid <string> --moid <string>`: Generate a shareable URL for a specific moment posted by a contact in LightTalk.
- `light-talk get-shared-url-of-contact --uid <string>`: Generate a shareable profile URL for a contact in LightTalk.
- `light-talk delete-contact --uid <string>`: Remove a contact from your contact list in LightTalk.
- `light-talk ask-for-privilege`: Request elevated privileges or special access permissions in LightTalk (e.g., for deletion, moderation, API access, or advanced features).
- `light-talk list-ip-choices`: List available IP/address choices that can be used by the current LightTalk session.
- `light-talk change-my-ip --where <string>`: Change the current session's IP/address to one of the available choices.
- `light-talk edit-remark --uid <string> --remark <string>`: Edit the remark/note associated with a contact in LightTalk.
- `light-talk delete-remark --uid <string>`: Remove the remark/note associated with a contact in LightTalk.
- `light-talk create-group-chat [--uids <value> ...]`: Create a new group chat with a list of participants in LightTalk.
- `light-talk send-message-to-group --gid <string> --content <string> [--at <JSON>]`: Send a text message to a group chat, optionally addressing specific members.
- `light-talk get-group-chat-history --gid <string>`: Retrieve the chat history of a specific group in LightTalk.
- `light-talk send-image --uid <string> --img-url <string>`: Send an image to a specific contact in LightTalk by URL.
- `light-talk send-image-to-group --gid <string> --img-url <string> [--at <JSON>]`: Send an image to a group chat by URL, optionally mentioning members.
- `light-talk rename-group --gid <string> --name <string>`: Change the display name of an existing group chat in LightTalk.
- `light-talk delete-group --gid <string>`: Delete an existing group chat in LightTalk.
- `light-talk change-owner-of-group --gid <string> --uid <string>`: Transfer group ownership to another member in LightTalk.
- `light-talk quit-group --gid <string>`: Leave a group chat in LightTalk.
- `light-talk invite-new-member --gid <string> --uid <string>`: Invite a new member into an existing group chat in LightTalk.
- `light-talk list-all-groups`: List all group chats that the current user is a member of in LightTalk.
- `light-talk get-group-info --gid <string>`: Retrieve detailed information about a specific group chat in LightTalk.
- `light-talk mark-as-read-in-group --gid <string>`: Mark a group's chat as read for the current user in LightTalk.
- `light-talk mark-as-unread-in-group --gid <string>`: Mark a group's chat as unread so it appears to have new messages in LightTalk.
- `light-talk acc-network`: Optimize and accelerate the network connection for LightTalk to reduce latency and improve responsiveness.
- `light-talk get-my-name`: Retrieve your own display name in LightTalk.

### light-shop

- `light-shop list-all-shop-categories`: Retrieve a list of all available shop categories in LightShop.
- `light-shop get-shop-id-by-name --shop-name <string>`: Look up a shop's unique ID (SID) by its display name in LightShop.
- `light-shop list-items --sid <string>`: List all items available in a specific shop in LightShop.
- `light-shop add-to-cart --sid <string> --tid <string> --cnt <integer>`: Add a specified quantity of an item from a shop to your shopping cart in LightShop.
- `light-shop get-item-info --sid <string> --tid <string>`: Retrieve detailed information about a specific item in a shop in LightShop.
- `light-shop delete-item-in-cart --caid <string>`: Remove a specific item from your shopping cart in LightShop.
- `light-shop check-balance`: Check your current account balance in LightShop.
- `light-shop checkout-all`: Complete the purchase of all items currently in your shopping cart in LightShop.
- `light-shop get-trans-history`: Retrieve your transaction history in LightShop, including purchased items and quantities.
- `light-shop list-all-shops-by-category --category <string>`: List all shops in LightShop that belong to a specific category.
- `light-shop get-cart-summary`: Retrieve a summary of the current shopping cart in LightShop, including total price and item counts.
- `light-shop search-shops --shop-name <string>`: Search for shops in LightShop by exact or partial name match (case-insensitive).
- `light-shop fuzzy-search-shops --shop-name <string>`: Perform a fuzzy (approximate) search for shops in LightShop based on shop name.
- `light-shop search-items --item-name <string>`: Search for items across all shops in LightShop by item name (exact or partial match).
- `light-shop fuzzy-search-items --item-name <string>`: Perform a fuzzy (approximate) search for items across all shops in LightShop by item name.
- `light-shop search-items-in-shop --sid <string> --item-name <string>`: Search for items within a specific shop in LightShop by item name (exact or partial match).
- `light-shop fuzzy-search-items-in-shop --sid <string> --item-name <string>`: Perform a fuzzy search for items within a specific shop in LightShop by item name.
- `light-shop get-trans-info --trid <string>`: Retrieve detailed information about a specific transaction in LightShop.
- `light-shop delete-trans-history --trid <string>`: Delete a specific transaction record from your transaction history in LightShop.
- `light-shop star-shop --sid <string>`: Mark a shop as starred (favorited) in LightShop for quick access.
- `light-shop unstar-shop --sid <string>`: Remove a shop from your starred (favorited) list in LightShop.
- `light-shop star-item --sid <string> --tid <string>`: Mark a specific item as starred (favorited) in LightShop.
- `light-shop unstar-item --sid <string> --tid <string>`: Remove a specific item from your starred (favorited) list in LightShop.
- `light-shop get-starred-shops`: Retrieve a list of all shops you have starred (favorited) in LightShop.
- `light-shop get-my-starred-items`: Retrieve a list of all items you have starred (favorited) in LightShop.
- `light-shop wait-payment-password`: Prompt the user to enter or verify their payment password in LightShop. This step is required before proceeding with checkout.

### light-weather

- `light-weather list-cities`: List all cities supported by LightWeather.
- `light-weather get-current-weather --location <string>`: Get the current weather observation for a city.
- `light-weather get-forecast --location <string> --days <integer>`: Get a multi-day weather forecast for a city.
- `light-weather get-hourly-forecast --location <string> --hours <integer>`: Get an hourly weather forecast for a city.
- `light-weather list-stations`: List all available weather stations in LightWeather.
- `light-weather get-station-info --station-id <string>`: Get metadata for a specific weather station.
- `light-weather get-station-observation --station-id <string>`: Get the latest weather observation from a specific weather station.
- `light-weather get-historical-weather --location <string> --start <string> --end <string>`: Fetch historical weather records for a location over a specified date range.
- `light-weather get-weather-alerts --location <string>`: Retrieve active weather alerts (e.g., storms, heatwaves) for a location.
- `light-weather create-alert --location <string> --condition <string> --threshold <number>`: Create a custom weather alert for a location based on a condition and threshold.
- `light-weather delete-alert --alert-id <string>`: Delete an existing custom weather alert by its ID.
- `light-weather list-alerts`: List all custom weather alerts created during the current session.
- `light-weather get-uv-index --location <string>`: Get the current UV index and risk level for a location.
- `light-weather get-air-quality --location <string>`: Get the current air quality index (AQI) and category for a location.
- `light-weather get-sun-times --location <string>`: Get sunrise and sunset times for a location on the current date.
- `light-weather convert-temperature --value <number> --from-unit <string> --to-unit <string>`: Convert a temperature value between Celsius, Fahrenheit, and Kelvin.
- `light-weather estimate-travel-weather [--route <value> ...]`: Estimate current weather conditions along a travel route consisting of multiple cities.
- `light-weather compare-climate --location1 <string> --location2 <string>`: Compare average climate conditions (e.g., temperature, rainfall) between two locations.
- `light-weather get-precip-probability --location <string> --next-hours <integer>`: Get the probability of precipitation for each hour over the next N hours in a location.
- `light-weather get-wind-forecast --location <string> --hours <integer>`: Get a wind speed and direction forecast for a location over the next N hours.
- `light-weather get-climate-summary --location <string> --year <integer>`: Get an annual climate summary for a location and year, including temperature and precipitation trends.
- `light-weather set-primary-location --location <string>`: Set a default primary location for weather queries in the current session.
- `light-weather get-primary-location`: Retrieve the current session's primary location, if one has been set.

### light-flight

- `light-flight list-all-cities`: Retrieve a list of all cities that have airports in LightFlight.
- `light-flight list-airports-by-city --city <string>`: List all airports located in a specific city in LightFlight.
- `light-flight get-flight-details --fid <string>`: Get detailed information about a specific flight in LightFlight using its unique flight ID (FID).
- `light-flight search-flights --departure <string> --arrival <string> --date <string>`: Search for available flights between two cities on a specific date in LightFlight.
- `light-flight check-seat-availability --fid <string> --seat-class <string>`: Check the number of remaining seats for a specific cabin class on a given flight in LightFlight.
- `light-flight check-passengers`: List all passengers currently registered in your LightFlight profile.
- `light-flight add-passenger --name <string> --light-talk-uid <string>`: Add a new passenger to your LightFlight profile for booking purposes.
- `light-flight remove-passenger --passenger-idx <integer>`: Remove a passenger from your LightFlight profile by their index.
- `light-flight add-to-booking --fid <string> --seat-class <string> --passenger-idx <integer>`: Add a flight seat for a specific passenger to your current booking cart in LightFlight.
- `light-flight check-bookings`: View all flight bookings currently in your cart (both paid and unpaid) in LightFlight.
- `light-flight remove-from-booking --bid <string>`: Remove an unpaid booking item from your cart using its booking ID (BID) in LightFlight.
- `light-flight wait-payment-password`: Prompt the user to enter their payment password in LightFlight. This step is required before checkout.
- `light-flight checkout-bookings`: Complete payment for all unpaid bookings in your cart in LightFlight.
- `light-flight check-balance`: Check your current account balance in LightFlight.
- `light-flight get-booking-history`: Retrieve your historical flight booking records in LightFlight.
- `light-flight cancel-booking [--bids <value> ...]`: Cancel one or more paid bookings and receive a 95% refund in LightFlight.
- `light-flight search-airports --airport-name <string>`: Search for airports by name (partial match) in LightFlight.
- `light-flight star-airport --aid <string>`: Mark an airport as starred (favorited) in LightFlight for quick access.
- `light-flight unstar-airport --aid <string>`: Remove an airport from your starred list in LightFlight.
- `light-flight get-my-starred-airports`: Retrieve a list of all airports you have starred in LightFlight.
- `light-flight get-fids-by-arrival --arrival <string>`: Retrieve all flight IDs (FIDs) that arrive at a specific destination city in LightFlight.
- `light-flight get-fids-by-departure --departure <string>`: Retrieve all flight IDs (FIDs) that depart from a specific origin city in LightFlight.

### light-stock

- `light-stock get-account-summary`: Retrieve a summary of your account status in LightStock, including user tier and balances.
- `light-stock list-all-sectors`: List all industry sectors available in LightStock.
- `light-stock list-all-tickers-by-sector --sector <string>`: List all stock tickers belonging to a specific industry sector in LightStock.
- `light-stock search-stocks --query <string>`: Search for stocks by ticker symbol or company name in LightStock.
- `light-stock get-stock-details --ticker <string>`: Get detailed information about a specific stock, including price, P/E ratio, market cap, and description.
- `light-stock wait-trade-password`: Authenticate the user by entering the trading password. Required before placing orders or upgrading to VIP.
- `light-stock transfer-funds --amount <number> --direction <string>`: Transfer funds between your trading account and savings account in LightStock.
- `light-stock place-market-order --ticker <string> --side <string> --quantity <integer>`: Place a market order to buy or sell a stock at the current market price.
- `light-stock place-limit-order --ticker <string> --side <string> --quantity <integer> --limit-price <number>`: Place a limit order to buy or sell a stock only at a specified price or better.
- `light-stock place-stop-loss-order --ticker <string> --quantity <integer> --stop-price <number>`: Place a stop-loss order to automatically sell a stock when its price falls to a specified level. (VIP-only feature)
- `light-stock get-portfolio`: Retrieve your current stock holdings (positions) in LightStock.
- `light-stock get-pending-orders`: List all active pending orders (limit or stop-loss) in your account.
- `light-stock cancel-order --oid <string>`: Cancel a pending order by its unique order ID and release any frozen funds.
- `light-stock get-trade-history`: Retrieve a complete history of all executed trades in your account.
- `light-stock toggle-watchlist --ticker <string>`: Add or remove a stock from your watchlist in LightStock.
- `light-stock get-watchlist-details`: Get current price and key metrics for all stocks in your watchlist.
- `light-stock check-vip-price`: Check the current fee required to upgrade your account to VIP status in LightStock.
- `light-stock upgrade-to-vip`: Upgrade your account to VIP status to unlock advanced features like short selling and unlimited day trades.
- `light-stock get-day-trades-remaining`: Check how many day trades you have left today. Basic users have a daily limit; VIP users have unlimited trades.
- `light-stock set-price-alert --ticker <string> --price <number>`: Set a price alert for a stock to notify you when it reaches a target price.
- `light-stock remove-price-alert --ticker <string>`: Remove an existing price alert for a stock.

### light-news

- `light-news list-all-sections`: Retrieve a list of all available news sections (categories) in LightNews, such as 'World', 'Technology', 'Sports', etc.
- `light-news get-last-k-news --section <string> --k <integer>`: Fetch the most recent K news articles from a specific section in LightNews.
- `light-news search --section <string> --query <string> --maxn <integer> [--begin-date <string>] [--end-date <string>]`: Search for news articles in a specific section using keywords, with optional date range filtering.
- `light-news get-details --nid <string>`: Retrieve the full content and metadata of a specific news article in LightNews using its unique ID.
- `light-news get-news-url --nid <string>`: Retrieve the shareable URL for a specific news article in LightNews using its unique ID.
