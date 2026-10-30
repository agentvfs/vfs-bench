from typing import List, Dict, Any
from software.utils.dist import lev_sim

def exact_match(x: str, y: str):
    return x == y

def fuzzy_match(x: str, y: str):
    if x is None:
        return y is None
    if y is None:
        return x is None

    x = x.lower().strip()
    y = y.lower().strip()

    return y == x or (len(x) >= 10 and y in x) or lev_sim(x, y) > 0.7

exclude_keys = {
    "timestamp",
    "mid", "moid", "cid", "gid", # LightTalk
    "sid", "tid", "caid", # LightShop
    "aid", # LightWeather
    "bid", "brid", "rid", # LightFlight
    "oid", # LightStock
    "nid" # LightNews
}

eq_methods = {
    "content": fuzzy_match
}
         
def __at(arr: List[Any], idx: int):
    if not isinstance(arr, list):
        return None

    return arr[idx] if idx < len(arr) else None

def __get(dic: Dict[str, Any], key: str):
    if not isinstance(dic, dict):
        return None
    
    return dic.get(key)

def judge_env(
    old_env: Dict[str, Any],
    new_env: Dict[str, Any],
    gt_env: Dict[str, Any],
    verbose: bool = False
) -> Dict[str, int]:
    total = 0
    recall = 0
    misbehave = 0

    def dfs(
        old_env_item: Dict[str, Any] | List[Any] | None,
        new_env_item: Dict[str, Any] | List[Any] | None,
        gt_env_item: Dict[str, Any] | List[Any] | None,
        key: str = ""
    ):
        nonlocal total, recall, misbehave
        if key in exclude_keys:
            return
        if isinstance(gt_env_item, list):
            length = max(
                len(gt_env_item),
                len(old_env_item) if isinstance(old_env_item, list) else 0,
                len(new_env_item) if isinstance(new_env_item, list) else 0
            )
            for i in range(length):
                dfs(
                    __at(old_env_item, i),
                    __at(new_env_item, i),
                    __at(gt_env_item, i),
                    key=key
                )
            return

        if isinstance(gt_env_item, dict):
            keys = set(
                list(gt_env_item.keys()) + \
                (list(old_env_item.keys()) if isinstance(old_env_item, dict) else []) + \
                (list(new_env_item.keys()) if isinstance(new_env_item, dict) else [])
            )
            for sub_key in keys:
                dfs(
                    __get(old_env_item, sub_key),
                    __get(new_env_item, sub_key),
                    __get(gt_env_item, sub_key),
                    key=sub_key
                )
            return
        __eq_func = eq_methods.get(key, exact_match)
        if __eq_func(old_env_item, gt_env_item):
            if not __eq_func(old_env_item, new_env_item):
                misbehave += 1
                if verbose:
                    print(f"misbehave: [{key}] ({new_env_item}) GT: ({gt_env_item})")
        else:
            total += 1
            if __eq_func(new_env_item, gt_env_item):
                recall += 1
            elif verbose:
                print(f"incorrect: [{key}] ({new_env_item}) GT: ({gt_env_item})")
    
    
    dfs(
        old_env_item=old_env,
        new_env_item=new_env,
        gt_env_item=gt_env
    )

    return {
        "total": total,
        "recall": recall,
        "misbehave": misbehave
    }



if __name__ == "__main__":
    old_env = {
        "apple": {
            "price": 100,
            "count": 20,
            "ids": [1,2,3]
        },
        "banana": {
            "price": 120,
            "count": 15,
            "ids": [1,2]
        },
        "melon": {
            "price": 100,
            "count": 70,
            "ids": [1,2,3,4]
        }
    }

    gt_env = {
        "apple": {
            "price": 110, # 1
            "count": 20,
            "ids": [1,2] # 2
        },
        "banana": {
            "price": 100, # 3
            "count": 15,
            "ids": [1,2,3] # 4
        }
    }

    new_env = {
        "apple": {
            "price": 110,
            "count": 20,
            "ids": [1,2]
        },
        "banana": {
            "price": 120,
            "count": 10,
            "ids": [1,2]
        }
    }

    result = judge_env(old_env, new_env, gt_env, verbose=True)
    print(result)