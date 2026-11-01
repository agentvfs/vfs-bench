"""Build the Monty compatibility port from the pinned MIT reference sources.

Run with Python 3.12; --check detects drift without rewriting artifacts.
The transformations remove Pydantic/Enum, logging and module loading only.
The judge, checkers, prompts and scenario parser retain their reference logic.
"""
import argparse
import ast
import hashlib
import json
import string
import textwrap
from pathlib import Path

HERE = Path(__file__).resolve().parent
REFERENCE = HERE / 'reference'
HARD = {
    'eq_checker', 'unordered_list_checker', 'datetime_checker',
    'list_attendees_checker', 'phone_number_checker', 'eq_str_strip_checker',
    'path_checker', 'unordered_path_list_checker'
}
SCRIPTED = {'contain_any_checker', 'contain_all_checker'}
SUBTASK = {
    'content_checker', 'user_message_checker', 'event_checker',
    'sanity_checker'
}


def expr(text):
    return ast.parse(text, mode='eval').body


class Compat(ast.NodeTransformer):

    def visit_Import(self, node):
        node.names = [
            n for n in node.names
            if n.name not in ('logging', 'textwrap', 'string')
        ]
        return node if node.names else None

    def visit_ImportFrom(self, node):
        excluded = ('gaia2_', 'pydantic', 'enum', '__future__')
        if node.module.startswith(excluded):
            return None
        return node

    def visit_ClassDef(self, node):
        if node.name in ('CheckerType', 'SoftCheckerType'):
            return None
        if node.bases:  # Pydantic models become ordinary dataclasses.
            assert len(node.bases) == 1 and ast.unparse(
                node.bases[0]) == 'BaseModel'
            node.bases = []
            node.decorator_list = [ast.Name(id='dataclass', ctx=ast.Load())]
        return self.generic_visit(node)

    def visit_FunctionDef(self, node):
        node.decorator_list = []  # tool_name becomes an ordinary method.
        if node.name == 'jinja_format':
            # All pinned templates use plain variable substitution. Unlike
            # sequential replacement, values containing {{...}} stay literal.
            return ast.parse(r'''def jinja_format(template, **kwargs):
    parts = re.split(r"\{\{\s*(\w+)\s*\}\}", template)
    return "".join(str(kwargs.get(value, "")) if i % 2 else value
                   for i, value in enumerate(parts))
''').body[0]
        result = self.generic_visit(node)
        if not result.body:
            result.body = [ast.Pass()]
        return result

    def visit_Try(self, node):
        # Upstream treats unavailable optional LLM dependencies as hard-only
        # grading. A port compatibility failure must never silently pass.
        # Likewise, losing the audit log is a verifier error here.
        source = ast.unparse(node)
        if ('self._llm_checkers = build_llm_checkers(' in source
                or 'with open(self._judgments_path' in source):
            return [
                self.visit(n) for n in node.body
                if not isinstance(n, ast.ImportFrom)
            ]
        return self.generic_visit(node)

    def visit_Assign(self, node):
        if any(
                isinstance(n, ast.Name) and n.id in ('logger', 'model_config')
                for n in node.targets):
            return None
        return self.generic_visit(node)

    def visit_Expr(self, node):
        if isinstance(node.value, ast.Call) and isinstance(
                node.value.func, ast.Attribute):
            if isinstance(node.value.func.value,
                          ast.Name) and node.value.func.value.id == 'logger':
                return ast.Pass()
        return self.generic_visit(node)

    def visit_Attribute(self, node):
        if ast.unparse(node) == 'string.punctuation':
            return ast.Constant(string.punctuation)
        if isinstance(node.value, ast.Name):
            if node.value.id in ('CheckerType', 'SoftCheckerType'):
                return ast.Constant(node.attr)
            if node.value.id == 'P':
                return ast.Name(id=node.attr, ctx=ast.Load())
        if node.attr == 'value' and isinstance(
                node.value,
                ast.Name) and node.value.id in ('check_type', 'checker_type'):
            return node.value
        if node.attr == 'need_subtask':
            return expr(f'{ast.unparse(node.value)} in {sorted(SUBTASK)!r}')
        node = self.generic_visit(node)
        if node.attr == 'value' and isinstance(node.value, ast.Constant):
            return node.value
        if node.attr == 'tool_name' and isinstance(node.ctx, ast.Load):
            return ast.Call(func=node, args=[], keywords=[])
        return node

    def visit_Call(self, node):
        if ast.unparse(node.func) == 'datetime.fromtimestamp':
            assert len(node.args) == 1 and ast.unparse(
                node.keywords[0].value) == 'timezone.utc'
            return expr(f'_utc_fromtimestamp({ast.unparse(node.args[0])})')
        if (isinstance(node.func, ast.Attribute)
                and node.func.attr == 'translate' and len(node.args) == 1
                and isinstance(node.args[0], ast.Call)
                and ast.unparse(node.args[0].func) == 'str.maketrans'):
            assert ast.unparse(
                node.args[0]) == "str.maketrans('', '', string.punctuation)"
            return expr(f"''.join(c for c in {ast.unparse(node.func.value)} "
                        f"if c not in {string.punctuation!r})")
        if ast.unparse(node.func) == 'textwrap.dedent':
            return ast.Constant(textwrap.dedent(ast.literal_eval(
                node.args[0])))
        if ast.unparse(node.func) == 'json.dumps':
            node.keywords = [k for k in node.keywords if k.arg != 'default']
        if isinstance(node.func,
                      ast.Attribute) and node.func.attr in ('is_hard',
                                                            'is_scripted'):
            choices = HARD if node.func.attr == 'is_hard' else SCRIPTED
            return expr(
                f'{ast.unparse(node.func.value)} in {sorted(choices)!r}')
        if isinstance(node.func, ast.Name) and node.func.id == 'Field':
            node.func.id = 'field'
        return self.generic_visit(node)


def build():
    parts = [
        '# Generated by build.py from the MIT reference at a9fd2ed.\n'
        'from __future__ import annotations\n'
        'from dataclasses import dataclass, field\n'
        'from datetime import timedelta\n'
        'import math\n'
        'def _utc_fromtimestamp(value):\n'
        '    seconds = math.floor(value)\n'
        '    micros = round((value - seconds) * 1000000)\n'
        '    epoch = datetime(1970, 1, 1, tzinfo=timezone.utc)\n'
        '    return epoch + timedelta(seconds=seconds, microseconds=micros)\n'
    ]
    for name in ('types', 'config', 'prompts', 'checkers', 'loader', 'judge'):
        tree = Compat().visit(ast.parse(
            (REFERENCE / f'{name}.py').read_text()))
        ast.fix_missing_locations(tree)
        parts.append(ast.unparse(tree))
    return '\n\n'.join(parts) + '\n'


def main():
    parser = argparse.ArgumentParser(__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    port = build().encode()
    manifest = {
        'upstream_commit': 'a9fd2edccb4bc7e22fbf45c8482a5fef30a2a5a4',
        'reference': {
            p.name: hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted(REFERENCE.glob('*.py'))
        },
        'port_sha256': hashlib.sha256(port).hexdigest(),
    }
    outputs = {
        'port.py': port,
        'sources.json': (json.dumps(manifest, indent=2) + '\n').encode()
    }
    for name, data in outputs.items():
        path = HERE / name
        if args.check:
            if not path.exists() or path.read_bytes() != data:
                raise SystemExit(f'Stale GAIA2 artifact: {path}')
        else:
            path.write_bytes(data)


if __name__ == '__main__':
    main()
