"""Unit-cost Unicode Levenshtein distance, replacing the C extension only.

Bit-parallel dynamic programming (Myers), using Python's arbitrary-precision
integers. Space is linear in the shorter string; no quadratic matrix.
The judge's normalization, substring rule and strict > 0.7 stay unchanged.
"""


def lev_sim(x, y):
    size = max(len(x), len(y))
    if not size:
        return 1.0
    if len(x) > len(y):
        x, y = y, x
    if not x:
        return 0.0
    masks = {}
    for i, char in enumerate(x):
        masks[char] = masks.get(char, 0) | (1 << i)
    positive, negative = ~0, 0
    distance = len(x)
    last = 1 << (len(x) - 1)
    for char in y:
        equal = masks.get(char, 0)
        vertical = equal | negative
        horizontal = (((equal & positive) + positive) ^ positive) | equal
        plus = negative | ~(horizontal | positive)
        minus = positive & horizontal
        if plus & last:
            distance += 1
        elif minus & last:
            distance -= 1
        plus = (plus << 1) | 1
        minus <<= 1
        positive = minus | ~(vertical | plus)
        negative = plus & vertical
    return 1 - distance / size
