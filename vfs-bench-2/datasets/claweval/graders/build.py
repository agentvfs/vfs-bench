"""Build the TypeScript port of Claw-Eval's graders from upstream's Python.

Upstream's grader sources at the pinned commit are vendored byte for byte
(``--vendor`` copies them from ``state/claweval/src`` after ``download.py``,
checking each against ``manifest.json``): each task's ``grader.py`` in its
task's directory, the modules they share in ``reference/``, with
``tasks.json``, the fields of each task's ``task.yaml`` the graders read.
This script compiles each module, statement for statement, over ``py.ts``,
which gives the values Python's semantics: a task's grader to
``grader.ts`` beside it, the shared modules to ``port/``. ``--check``
fails if a vendored source is not its pin or a port differs from what it
would write.

Run with Python 3.12 or later from any directory.
"""
import argparse
import ast
import hashlib
import json
import posixpath
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATASET = HERE.parent
REFERENCE = HERE / "reference"
PORT = HERE / "port"
MANIFEST = HERE / "manifest.json"
UPSTREAM = HERE.parents[2] / "state/claweval/src"
# The graders that quote the config-audit fixtures' planted credentials,
# which GitHub's push protection refuses (see ../.gitignore): their
# reference copies and ports are gitignored, and download.py writes them
# (--withheld). Each is its grader class, and whether its grade takes
# media_events, for the registry, which is committed.
WITHHELD = {
    "T027zh_api_config_audit": ("APIConfigAuditGrader", True),
    "T028_api_config_audit": ("APIConfigAuditGraderEN", True),
    "T089_pinbench_config_workflow_notes":
    ("PinbenchConfigWorkflowNotesGrader", True),
}
SHARED = [
    "src/claw_eval/graders/base.py",
    "src/claw_eval/graders/llm_judge.py",
    "src/claw_eval/graders/officeqa_reward.py",
    "src/claw_eval/graders/pinbench_common.py",
    "src/claw_eval/models/scoring.py",
]
# What upstream's modules import from where: the models are models.ts, the
# standard library py.ts.
MODELS = {
    "claw_eval.models.trace", "claw_eval.models.task",
    "claw_eval.models.content", "claw_eval.models.message",
    "claw_eval.models.tool"
}
RUNTIME_MODULES = {
    "json": "$.json",
    "re": "$.re",
    "time": "$.time",
    "random": "$.random",
    "logging": "$.logging",
    "math": "$.math",
    "httpx": "$.httpx",
}
RUNTIME_NAMES = {
    ("datetime", "datetime"): "$.datetime",
    ("datetime", "date"): "$.date",
    ("datetime", "timedelta"): "$.timedelta",
    ("datetime", "timezone"): "$.timezone",
    ("openai", "OpenAI"): "OpenAI",
}
IGNORED_MODULES = {
    "__future__", "typing", "abc", "pathlib", "pydantic", "inspect",
    "importlib", "importlib.util"
}
BUILTINS = {
    "len": "$.len",
    "str": "$.str",
    "int": "$.int",
    "float": "$.float",
    "bool": "$.bool",
    "list": "$.list",
    "dict": "$.dict",
    "set": "$.set",
    "frozenset": "$.frozenset",
    "tuple": "$.tupleOf",
    "sorted": "$.sorted",
    "reversed": "$.reversed",
    "enumerate": "$.enumerate",
    "zip": "$.zip",
    "range": "$.range",
    "min": "$.min",
    "max": "$.max",
    "sum": "$.sum",
    "any": "$.any",
    "all": "$.all",
    "abs": "$.abs",
    "round": "$.round",
    "isinstance": "$.isinstance",
    "getattr": "$.getattr",
    "hasattr": "$.hasattr",
    "print": "$.print",
    "type": "$.type",
    "repr": "$.repr",
    "format": "$.format",
}
EXCEPTIONS = {
    "BaseException": "$.BaseException",
    "Exception": "$.Exception",
    "ValueError": "$.ValueError",
    "KeyError": "$.KeyError",
    "TypeError": "$.TypeError_",
    "IndexError": "$.IndexError",
    "AttributeError": "$.AttributeError",
    "ZeroDivisionError": "$.ZeroDivisionError",
    "RuntimeError": "$.RuntimeError",
    "FileNotFoundError": "$.FileNotFoundError",
    "ImportError": "$.ImportError",
    "StopIteration": "$.StopIteration",
}
MODEL_CLASSES = {
    "TextBlock", "ToolUseBlock", "ToolResultBlock", "ImageBlock", "AudioBlock",
    "VideoBlock", "Message", "DimensionScores", "TraceMessage", "ToolDispatch",
    "MediaLoad", "TaskDefinition", "TokenUsage"
}
RESERVED = {
    "default", "function", "var", "new", "delete", "in", "class", "this",
    "switch", "case", "const", "let", "enum", "export", "extends", "super",
    "typeof", "void", "with", "yield", "package", "private", "protected",
    "public", "interface", "static", "arguments", "eval", "await",
    "instanceof", "do", "catch", "finally", "throw", "try", "debugger", "null",
    "true", "false", "undefined", "NaN", "Infinity", "implements"
}
BOOLEAN_CALLS = {"any", "all", "isinstance", "hasattr", "bool", "callable"}
COMPREHENSIONS = (ast.ListComp, ast.SetComp, ast.DictComp, ast.GeneratorExp)
# The datetime module's classes, which the port calls as classes.
DATETIME = ("datetime", "timezone", "date", "timedelta")
ARITHMETIC = (ast.Add, ast.Sub, ast.Mult, ast.Pow, ast.Mod, ast.FloorDiv)


class Unsupported(Exception):
    pass


def ts_string(s):
    """A TypeScript string literal for ``s``: a template literal when it has
    line breaks, so that prompts read as written."""
    if "\n" in s and len(s) > 60:
        body = s.replace("\\", "\\\\").replace("`",
                                               "\\`").replace("${", "\\${")
        body = "".join(
            ch if ch in "\n\t" or 0x20 <= ord(ch) else f"\\u{ord(ch):04x}"
            for ch in body)
        return "`" + body + "`"
    return json.dumps(s, ensure_ascii=False)


def module_name(relative):
    """``src/claw_eval/graders/base.py`` -> ``claw_eval.graders.base``."""
    parts = relative.removesuffix(".py").split("/")
    if parts[0] == "src":
        parts = parts[1:]
    return ".".join(parts)


def source_path(relative):
    """Where an upstream source is vendored: a task's grader in its task's
    directory, the rest under ``reference/``."""
    if relative.startswith("tasks/"):
        return DATASET / relative.split("/")[1] / "grader.py"
    return REFERENCE / relative


def upstream_path(path):
    """``source_path``'s inverse."""
    if path.is_relative_to(REFERENCE):
        return path.relative_to(REFERENCE).as_posix()
    return f"tasks/{path.parent.name}/grader.py"


def vendored():
    """Every vendored source, as upstream's path."""
    return sorted([upstream_path(p) for p in REFERENCE.rglob("*.py")] +
                  [upstream_path(p) for p in DATASET.glob("*/grader.py")])


def port_path(relative):
    """Where a module's port is written, under the dataset: a task's
    grader beside its source, the rest under ``graders/port/``."""
    if relative.startswith("tasks/"):
        return f"{relative.split('/')[1]}/grader.ts"
    return "graders/port/" + relative.removeprefix("src/").removesuffix(
        ".py") + ".ts"


def withheld(path):
    """Whether a port's path (under the dataset) is a withheld grader's."""
    return Path(path).parts[0] in WITHHELD


def relative_import(source, target):
    """``target`` (a path under the dataset) as imported from ``source``."""
    path = posixpath.relpath(target, posixpath.dirname(source))
    return path if path.startswith("../") else "./" + path


class Scope:

    def __init__(self, parent=None, kind="module", names=()):
        self.parent = parent
        self.kind = kind
        self.names = set(names)
        self.floats = set()

    def lookup(self, name):
        scope = self
        while scope is not None:
            if name in scope.names:
                return scope
            scope = scope.parent
        return None


def assigned(body):
    """The names a function body binds, outside comprehensions and nested
    functions (whose own names it does bind)."""
    names = []

    def targets(node):
        if isinstance(node, ast.Name):
            names.append(node.id)
        elif isinstance(node, (ast.Tuple, ast.List)):
            for e in node.elts:
                targets(e)
        elif isinstance(node, ast.Starred):
            targets(node.value)

    def visit(node):
        if isinstance(node, (ast.FunctionDef, ast.ClassDef)):
            names.append(node.name)
            return
        if isinstance(node, ast.Lambda):
            return
        if isinstance(node, ast.Assign):
            for t in node.targets:
                targets(t)
        elif isinstance(node, (ast.AugAssign, ast.AnnAssign)):
            if not (isinstance(node, ast.AnnAssign) and node.value is None):
                targets(node.target)
        elif isinstance(node, ast.For):
            targets(node.target)
        elif isinstance(node, ast.ExceptHandler) and node.name:
            names.append(node.name)
        elif isinstance(node, (ast.Import, ast.ImportFrom)):
            for a in node.names:
                names.append(a.asname or a.name.split(".")[0])
        for child in ast.iter_child_nodes(node):
            if isinstance(child, COMPREHENSIONS):
                continue
            visit(child)

    for stmt in body:
        visit(stmt)
    return list(dict.fromkeys(names))


def ident(name):
    return name + "_" if name in RESERVED else name


class Module:
    """One reference module compiled to TypeScript."""

    def __init__(self, build, relative):
        self.build = build
        self.relative = relative
        self.name = module_name(relative)
        self.out = port_path(relative)
        self.source = source_path(relative).read_text()
        self.tree = ast.parse(self.source)
        self.imports = []
        self.classes = set()
        self.temp = 0
        self.loops = []
        self.handlers = []

    # ------------------------------------------------------------- helpers

    def fresh(self, prefix="t"):
        self.temp += 1
        return f"${prefix}{self.temp}"

    def error(self, node, what):
        line = getattr(node, "lineno", "?")
        raise Unsupported(f"{self.relative}:{line}: {what}")

    # ------------------------------------------------------------- module

    def compile(self):
        module = Scope(kind="module")
        self.module_scope = module
        module.names.update(n for n in assigned(self.tree.body)
                            if n not in self.dropped())
        body = []
        for stmt in self.tree.body:
            body.extend(self.statement(stmt, module, 0, top=True))
        head = [
            "// Generated by graders/build.py from " +
            source_path(self.relative).relative_to(DATASET).as_posix() +
            "; do not edit.",
            "import * as $ from '" +
            relative_import(self.out, "graders/py.ts") + "'",
        ]
        head.extend(dict.fromkeys(self.imports))
        return "\n".join(head + [""] + body) + "\n"

    def dropped(self):
        """Module-level names this port leaves out: peer loading and the
        default tasks directory (upstream's file layout)."""
        return {"load_peer_grader", "_DEFAULT_TASKS_DIR"}

    def import_from(self, node, scope):
        module = node.module or ""
        if node.level:
            package = self.name.split(".")[:-node.level]
            module = ".".join(package + ([module] if module else []))
        if module in IGNORED_MODULES or module.split(".")[0] in ("typing",
                                                                 "pydantic"):
            for a in node.names:
                scope.names.discard(a.asname or a.name)
            return []
        out = []
        for a in node.names:
            local = a.asname or a.name
            if (module, a.name) in RUNTIME_NAMES:
                target = RUNTIME_NAMES[(module, a.name)]
                if target.startswith("$."):
                    out.append(f"const {ident(local)} = {target}")
                else:
                    client = relative_import(self.out,
                                             "graders/judge-client.ts")
                    self.imports.append(
                        f"import {{ {a.name} as {ident(local)} }} from "
                        f"'{client}'")
                    self.classes.add(local)
                continue
            if module in MODELS:
                self.imports.append(
                    f"import {{ {a.name} as {ident(local)} }} from '"
                    f"{relative_import(self.out, 'graders/models.ts')}'")
                if a.name in MODEL_CLASSES:
                    self.classes.add(local)
                continue
            if (module, a.name) == ("claw_eval.graders.base",
                                    "load_peer_grader"):
                scope.names.discard(local)
                continue
            target = self.build.module_file(module)
            if target is None:
                self.error(node, f"import from {module}")
            self.imports.append(
                f"import {{ {a.name} as {ident(local)} }} from '"
                f"{relative_import(self.out, target)}'")
            if self.build.is_class(module, a.name):
                self.classes.add(local)
        return out

    # ------------------------------------------------------------- statements

    def statement(self, node, scope, depth, top=False):
        pad = "  " * depth
        lines = []

        def emit(text):
            lines.append(pad + text)

        if isinstance(node, ast.Expr):
            if isinstance(node.value, ast.Constant) and isinstance(
                    node.value.value, str):
                return []  # a docstring
            if isinstance(node.value,
                          ast.Constant) and node.value.value is ...:
                return []
            emit(self.expr(node.value, scope) + ";")
        elif isinstance(node, ast.Import):
            for a in node.names:
                local = a.asname or a.name.split(".")[0]
                if a.name in RUNTIME_MODULES:
                    if top:
                        emit(
                            f"const {ident(local)} = {RUNTIME_MODULES[a.name]}"
                        )
                    else:
                        emit(f"{ident(local)} = {RUNTIME_MODULES[a.name]}")
                elif a.name in IGNORED_MODULES:
                    scope.names.discard(local)
                else:
                    self.error(node, f"import {a.name}")
        elif isinstance(node, ast.ImportFrom):
            for text in self.import_from(node, scope):
                emit(text)
        elif isinstance(node, ast.ClassDef):
            lines.extend(self.class_def(node, scope, depth))
        elif isinstance(node, ast.FunctionDef):
            if top and node.name in self.dropped():
                return []
            lines.extend(self.function(node, scope, depth, top=top))
        elif isinstance(node, (ast.Assign, ast.AnnAssign)):
            if isinstance(node, ast.AnnAssign) and node.value is None:
                return []
            targets = node.targets if isinstance(
                node, ast.Assign) else [node.target]
            if top and len(targets) == 1 and isinstance(
                    targets[0], ast.Name) and targets[0].id in self.dropped():
                return []
            if top and len(targets) == 1 and isinstance(targets[0], ast.Name):
                peer = self.peer(node.value)
                if peer is not None:
                    emit(f"export const {ident(targets[0].id)}: any = {peer}")
                    self.classes.add(targets[0].id)
                    return lines
            value = self.expr(node.value, scope)
            if len(targets) > 1:
                temp = self.fresh()
                emit(f"const {temp} = {value}")
                value = temp
            for target in targets:
                if top and isinstance(target, ast.Name):
                    name = ident(target.id)
                    if name in self.declared:
                        emit(f"{name} = {value}")
                    else:
                        self.declared.add(name)
                        emit(f"export let {name}: any = {value}")
                    continue
                for text in self.assign(target, value, scope):
                    emit(text)
        elif isinstance(node, ast.AugAssign):
            op = {
                ast.Add: "$.iadd",
                ast.Sub: "$.sub",
                ast.Mult: "$.mul",
                ast.Div: "$.div",
                ast.Mod: "$.mod",
                ast.FloorDiv: "$.floordiv",
                ast.BitOr: "$.bitor",
                ast.BitAnd: "$.bitand",
                ast.Pow: "$.pow",
            }.get(type(node.op))
            if op is None:
                self.error(node, "augmented operator")
            target = node.target
            if isinstance(target, ast.Name):
                name = self.name_ref(target.id, scope, node)
                emit(f"{name} = {op}({name}, {self.expr(node.value, scope)})")
            elif isinstance(target, ast.Attribute):
                obj = self.fresh()
                emit(f"const {obj}: any = {self.expr(target.value, scope)}")
                emit(f"{obj}.{target.attr} = {op}({obj}.{target.attr}, "
                     f"{self.expr(node.value, scope)})")
            elif isinstance(target, ast.Subscript):
                obj, key = self.fresh(), self.fresh()
                emit(f"const {obj}: any = {self.expr(target.value, scope)}")
                emit(f"const {key}: any = {self.expr(target.slice, scope)}")
                emit(f"$.si({obj}, {key}, {op}($.gi({obj}, {key}), "
                     f"{self.expr(node.value, scope)}))")
            else:
                self.error(node, "augmented target")
        elif isinstance(node, ast.If):
            emit(f"if ({self.test(node.test, scope)}) {{")
            for s in node.body:
                lines.extend(self.statement(s, scope, depth + 1))
            orelse = node.orelse
            while len(orelse) == 1 and isinstance(orelse[0], ast.If):
                emit(f"}} else if ({self.test(orelse[0].test, scope)}) {{")
                for s in orelse[0].body:
                    lines.extend(self.statement(s, scope, depth + 1))
                orelse = orelse[0].orelse
            if orelse:
                emit("} else {")
                for s in orelse:
                    lines.extend(self.statement(s, scope, depth + 1))
            emit("}")
        elif isinstance(node, (ast.For, ast.While)):
            flag = self.fresh("broke") if node.orelse else None
            if flag:
                emit(f"let {flag} = false")
            if isinstance(node, ast.For):
                item = self.fresh("v")
                iterable = self.expr(node.iter, scope)
                emit(f"for (const {item} of $.iter({iterable})) {{")
                for text in self.assign(node.target, item, scope):
                    emit("  " + text)
            else:
                emit(f"while ({self.test(node.test, scope)}) {{")
            self.loops.append(flag)
            for s in node.body:
                lines.extend(self.statement(s, scope, depth + 1))
            self.loops.pop()
            emit("}")
            if flag:
                emit(f"if (!{flag}) {{")
                for s in node.orelse:
                    lines.extend(self.statement(s, scope, depth + 1))
                emit("}")
        elif isinstance(node, ast.Break):
            flag = self.loops[-1] if self.loops else None
            emit(f"{{ {flag} = true; break }}" if flag else "break")
        elif isinstance(node, ast.Continue):
            emit("continue")
        elif isinstance(node, ast.Pass):
            pass
        elif isinstance(node, ast.Return):
            emit("return " + (self.expr(node.value, scope) if node.
                              value is not None else "null"))
        elif isinstance(node, ast.Raise):
            if node.exc is None:
                if not self.handlers:
                    self.error(node, "bare raise outside a handler")
                emit(f"throw {self.handlers[-1]}")
            elif isinstance(node.exc, ast.Call):
                emit(f"throw {self.expr(node.exc, scope)}")
            else:
                emit(f"throw {self.expr(node.exc, scope)}")
        elif isinstance(node, ast.Try):
            lines.extend(self.try_(node, scope, depth))
        elif isinstance(node, ast.Delete):
            for target in node.targets:
                if not isinstance(target, ast.Subscript):
                    self.error(node, "del of a non-subscript")
                emit(f"$.di({self.expr(target.value, scope)}, "
                     f"{self.expr(target.slice, scope)})")
        elif isinstance(node, ast.Assert):
            emit(f"if (!({self.test(node.test, scope)})) throw new "
                 "$.Exception('AssertionError')")
        else:
            self.error(node, type(node).__name__)
        return lines

    def peer(self, value):
        """``load_peer_grader("T...")``: the class upstream's loader picks
        from that task's module, as an import of it."""
        if not (isinstance(value, ast.Call) and isinstance(
                value.func, ast.Name) and value.func.id == "load_peer_grader"):
            return None
        task = value.args[0].value
        module = f"tasks.{task}.grader"
        chosen = self.build.peer_class(module)
        alias = "peer_" + task
        self.imports.append(
            f"import * as {alias} from "
            f"'{relative_import(self.out, task + '/grader.ts')}'")
        return f"{alias}.{chosen}"

    def try_(self, node, scope, depth):
        pad = "  " * depth
        lines = []
        flag = self.fresh("ok") if node.orelse else None
        if flag:
            lines.append(pad + f"let {flag} = false")
        lines.append(pad + "try {")
        for s in node.body:
            lines.extend(self.statement(s, scope, depth + 1))
        if flag:
            lines.append(pad + f"  {flag} = true")
        if node.handlers:
            error = self.fresh("e")
            lines.append(pad + f"}} catch ({error}) {{")
            lines.append(pad + f"  const {error}x = $.exc({error})")
            first = True
            for handler in node.handlers:
                if handler.type is None:
                    classes = "[$.BaseException]"
                elif isinstance(handler.type, ast.Tuple):
                    classes = "[" + ", ".join(
                        self.expr(e, scope) for e in handler.type.elts) + "]"
                else:
                    classes = f"[{self.expr(handler.type, scope)}]"
                keyword = "if" if first else "} else if"
                first = False
                lines.append(pad +
                             f"  {keyword} ($.caught({error}x, {classes})) {{")
                if handler.name:
                    name = self.name_ref(handler.name, scope, handler)
                    lines.append(pad + f"    {name} = {error}x")
                self.handlers.append(error)
                for s in handler.body:
                    lines.extend(self.statement(s, scope, depth + 2))
                self.handlers.pop()
            lines.append(pad + "  } else {")
            lines.append(pad + f"    throw {error}")
            lines.append(pad + "  }")
        if node.finalbody:
            lines.append(pad + "} finally {")
            for s in node.finalbody:
                lines.extend(self.statement(s, scope, depth + 1))
        lines.append(pad + "}")
        if flag:
            lines.append(pad + f"if ({flag}) {{")
            for s in node.orelse:
                lines.extend(self.statement(s, scope, depth + 1))
            lines.append(pad + "}")
        return lines

    def assign(self, target, value, scope):
        if isinstance(target, ast.Name):
            return [f"{self.name_ref(target.id, scope, target)} = {value}"]
        if isinstance(target, ast.Attribute):
            return [
                f"{self.expr(target.value, scope)}.{target.attr} = {value}"
            ]
        if isinstance(target, ast.Subscript):
            if isinstance(target.slice, ast.Slice):
                self.error(target, "slice assignment")
            return [
                f"$.si({self.expr(target.value, scope)}, "
                f"{self.expr(target.slice, scope)}, {value})"
            ]
        if isinstance(target, (ast.Tuple, ast.List)):
            if any(isinstance(e, ast.Starred) for e in target.elts):
                self.error(target, "starred assignment")
            items = self.fresh()
            out = [f"const {items} = $.unpack({value}, {len(target.elts)})"]
            for i, e in enumerate(target.elts):
                out.extend(self.assign(e, f"{items}[{i}]", scope))
            return out
        self.error(target, "assignment target")

    # ------------------------------------------------------------- functions

    def signature(self, args, scope, skip_self):
        positional = [a.arg for a in args.posonlyargs + args.args]
        if skip_self:
            positional = positional[1:]
        defaults = [self.expr(d, scope) for d in args.defaults]
        if skip_self and len(defaults) > len(positional):
            defaults = defaults[1:]
        options = []
        if args.vararg:
            options.append("star: true")
        if args.kwonlyargs:
            kw = ", ".join(
                f"[{json.dumps(a.arg)}, " +
                ("$.REQUIRED" if d is None else self.expr(d, scope)) + "]"
                for a, d in zip(args.kwonlyargs, args.kw_defaults))
            options.append(f"kwonly: [{kw}]")
        if args.kwarg:
            options.append("dstar: true")
        names = positional + ([args.vararg.arg] if args.vararg else []) + [
            a.arg for a in args.kwonlyargs
        ] + ([args.kwarg.arg] if args.kwarg else [])
        call = (
            f"$.bind($a, {json.dumps(positional)}, [{', '.join(defaults)}]" +
            (f", {{ {', '.join(options)} }}" if options else "") + ")")
        return names, call

    def function_body(self,
                      node,
                      scope,
                      depth,
                      names,
                      binding,
                      self_name=None):
        pad = "  " * depth
        inner = Scope(scope, "function",
                      names + ([self_name] if self_name else []))
        locals_ = [
            n for n in assigned(node.body) if n not in names and n != self_name
        ]
        inner.names.update(locals_)
        self.infer_floats(node.body, inner)
        lines = []
        if self_name:
            lines.append(pad + f"  const {ident(self_name)}: any = this")
        if names:
            lines.append(pad + "  let [" + ", ".join(ident(n) for n in names) +
                         f"] = {binding}")
        else:
            lines.append(pad + f"  {binding}")
        if locals_:
            lines.append(pad + "  let " +
                         ", ".join(ident(n) + ": any" for n in locals_))
        saved = self.loops, self.handlers
        self.loops, self.handlers = [], []
        for s in node.body:
            lines.extend(self.statement(s, inner, depth + 1))
        self.loops, self.handlers = saved
        return lines

    def function(self, node, scope, depth, top=False):
        pad = "  " * depth
        names, binding = self.signature(node.args, scope, False)
        if top:
            head = f"export function {ident(node.name)}(...$a: any[]): any {{"
        else:
            name = self.name_ref(node.name, scope, node)
            head = f"{name} = (...$a: any[]): any => {{"
        return [pad + head] + self.function_body(node, scope, depth, names,
                                                 binding) + [pad + "}"]

    def class_def(self, node, scope, depth):
        if depth:
            self.error(node, "nested class")
        pad = "  " * depth
        self.classes.add(node.name)
        bases = [b for b in node.bases]
        base = None
        model = False
        for b in bases:
            text = ast.unparse(b)
            if text in ("ABC", "object"):
                continue
            if text == "BaseModel":
                model = True
                continue
            base = self.expr(b, scope)
        lines = [
            pad + f"export class {node.name}" +
            (f" extends {base}" if base else "") + " {"
        ]
        attributes = []
        fields = []
        for stmt in node.body:
            if isinstance(stmt, ast.FunctionDef):
                lines.extend(self.method(stmt, node, scope, depth + 1, base))
            elif isinstance(stmt, (ast.Assign, ast.AnnAssign)):
                if isinstance(stmt, ast.AnnAssign):
                    if model:
                        fields.append((stmt.target.id, stmt.value))
                        continue
                    if stmt.value is None:
                        continue
                    targets = [stmt.target]
                else:
                    targets = stmt.targets
                attributes.append((targets, stmt.value))
            elif isinstance(stmt, ast.Expr) and isinstance(
                    stmt.value, ast.Constant):
                continue
            elif isinstance(stmt, ast.Pass):
                continue
            else:
                self.error(stmt, "class body statement")
        if model:
            # A Pydantic model's fields, its defaults the last ones'.
            names = [f for f, _ in fields]
            defaults = [d for _, d in fields if d is not None]
            if any(d is None for _, d in fields[len(fields) - len(defaults):]):
                self.error(node, "model field order")
            given = ", ".join(self.expr(d, scope) for d in defaults)
            lines += [
                pad + "  constructor(...$a: any[]) {",
                pad + "    const self: any = this",
                pad + f"    const [{', '.join(names)}] = "
                f"$.bind($a, {json.dumps(names)}, [{given}])",
                *(pad + f"    self.{n} = {n}" for n in names),
                pad + "  }",
                pad + "  model_dump() {",
                pad + f"    return new $.PyDict({json.dumps(names)}"
                ".map((k) => [k, (this as any)[k]]))",
                pad + "  }",
            ]
        lines.append(pad + "}")
        if attributes:
            body = Scope(scope, "class")
            lines.append(pad + "{")
            for targets, value in attributes:
                text = self.expr(value, body)
                for t in targets:
                    if not isinstance(t, ast.Name):
                        self.error(node, "class attribute target")
                    lines.append(pad + f"  const {ident(t.id)}: any = {text}")
                    lines.append(
                        pad + f"  ;({node.name} as any).prototype.{t.id} = "
                        f"({node.name} as any).{t.id} = {ident(t.id)}")
                    body.names.add(t.id)
            lines.append(pad + "}")
        return lines

    def method(self, node, cls, scope, depth, base):
        pad = "  " * depth
        decorators = [ast.unparse(d) for d in node.decorator_list]
        static = "staticmethod" in decorators
        classmethod = "classmethod" in decorators
        for d in decorators:
            if d not in ("staticmethod", "classmethod", "abstractmethod",
                         "property"):
                self.error(node, f"decorator {d}")
        if "property" in decorators:
            self.error(node, "property")
        names, binding = self.signature(node.args, scope, not static)
        self_name = None if static else node.args.args[0].arg
        if node.name == "__init__":
            lines = [pad + "constructor(...$a: any[]) {"]
            body = list(node.body)
            if base:
                call = body[0] if body else None
                explicit = (isinstance(call, ast.Expr)
                            and isinstance(call.value, ast.Call) and
                            ast.unparse(call.value.func) == "super().__init__")
                if explicit:
                    args = ", ".join(self.call_args(call.value, scope))
                    lines.append(pad + f"  super({args})")
                    body = body[1:]
                else:
                    lines.append(pad + "  super()")
            clone = ast.FunctionDef(name=node.name,
                                    args=node.args,
                                    body=body,
                                    decorator_list=[],
                                    returns=None)
            lines += self.function_body(clone, scope, depth, names, binding,
                                        self_name)
            return lines + [pad + "}"]
        name = node.name
        if static or classmethod:
            head = f"static {name}(...$a: any[]): any {{"
            out = [pad + head]
            if classmethod:
                out += self.function_body(node, scope, depth, names, binding,
                                          self_name)
            else:
                out += self.function_body(node, scope, depth, names, binding)
            out.append(pad + "}")
            out.append(pad + f"{name}(...$a: any[]): any {{")
            out.append(pad +
                       f"  return (this.constructor as any).{name}(...$a)")
            out.append(pad + "}")
            return out
        out = [pad + f"{name}(...$a: any[]): any {{"]
        out += self.function_body(node, scope, depth, names, binding,
                                  self_name)
        return out + [pad + "}"]

    # ------------------------------------------------------------- floats

    def is_float(self, node, scope):
        """Whether ``node`` is a Python float for sure (for how it prints)."""
        if isinstance(node, ast.Constant):
            return isinstance(node.value, float)
        if isinstance(node, ast.BinOp):
            if isinstance(node.op, ast.Div):
                return True
            if isinstance(node.op, ARITHMETIC):
                return self.is_float(node.left, scope) or self.is_float(
                    node.right, scope)
            return False
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub):
            return self.is_float(node.operand, scope)
        if isinstance(node, ast.IfExp):
            return self.is_float(node.body, scope) and self.is_float(
                node.orelse, scope)
        if isinstance(node, ast.Name):
            s = scope.lookup(node.id)
            return s is not None and node.id in s.floats
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
            f = node.func.id
            if f == "float":
                return True
            if f == "round" and len(node.args) == 2:
                return self.is_float(node.args[0], scope)
            if f in ("min", "max", "abs") and node.args and not node.keywords:
                return all(self.is_float(a, scope) for a in node.args)
        return False

    def infer_floats(self, body, scope):
        values = {}

        def visit(node):
            if isinstance(node, (ast.FunctionDef, ast.Lambda, ast.ClassDef)):
                return
            if isinstance(node, ast.Assign):
                for t in node.targets:
                    if isinstance(t, ast.Name):
                        values.setdefault(t.id, []).append(node.value)
                    else:
                        for n in ast.walk(t):
                            if isinstance(n, ast.Name):
                                values.setdefault(n.id, []).append(None)
            elif isinstance(node, ast.AnnAssign) and node.value is not None:
                if isinstance(node.target, ast.Name):
                    values.setdefault(node.target.id, []).append(node.value)
            elif isinstance(node, ast.AugAssign) and isinstance(
                    node.target, ast.Name):
                values.setdefault(node.target.id, []).append(
                    ast.BinOp(left=node.target, op=node.op, right=node.value))
            elif isinstance(node, ast.For):
                for n in ast.walk(node.target):
                    if isinstance(n, ast.Name):
                        values.setdefault(n.id, []).append(None)
            for child in ast.iter_child_nodes(node):
                visit(child)

        for stmt in body:
            visit(stmt)
        changed = True
        while changed:
            changed = False
            for name, exprs in values.items():
                if name in scope.floats:
                    continue
                if all(e is not None and self.is_float(e, scope) for e in exprs
                       if not (isinstance(e, ast.BinOp) and isinstance(
                           e.left, ast.Name) and e.left.id == name)):
                    if any(e is not None and self.is_float(e, scope)
                           for e in exprs):
                        scope.floats.add(name)
                        changed = True

    # ------------------------------------------------------------- names

    def name_ref(self, name, scope, node):
        if scope.lookup(name) is not None:
            return ident(name)
        if name in BUILTINS:
            return BUILTINS[name]
        if name in EXCEPTIONS:
            return EXCEPTIONS[name]
        if name == "__name__":
            return json.dumps(self.name)
        self.error(node, f"unknown name {name}")

    # ------------------------------------------------------------- expressions

    def test(self, node, scope):
        """``node`` as a JavaScript boolean."""
        if isinstance(node, ast.BoolOp):
            op = " && " if isinstance(node.op, ast.And) else " || "
            return "(" + op.join(self.test(v, scope)
                                 for v in node.values) + ")"
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.Not):
            return f"!{self.test(node.operand, scope)}"
        if isinstance(node, ast.Compare):
            return self.expr(node, scope)
        if isinstance(node, ast.Constant) and isinstance(node.value, bool):
            return "true" if node.value else "false"
        if isinstance(node, ast.Call) and isinstance(
                node.func, ast.Name) and node.func.id in BOOLEAN_CALLS and \
                self.module_scope.lookup(node.func.id) is None:
            return self.expr(node, scope)
        return f"$.t({self.expr(node, scope)})"

    def expr(self, node, scope):
        if isinstance(node, ast.Constant):
            v = node.value
            if v is None or v is ...:
                return "null"
            if isinstance(v, bool):
                return "true" if v else "false"
            if isinstance(v, int):
                return str(v) if abs(v) < 2**53 else f"Number('{v}')"
            if isinstance(v, float):
                if v != v:
                    return "NaN"
                if v in (float("inf"), float("-inf")):
                    return "Infinity" if v > 0 else "-Infinity"
                return repr(v)
            if isinstance(v, str):
                return ts_string(v)
            self.error(node, "constant")
        if isinstance(node, ast.Name):
            return self.name_ref(node.id, scope, node)
        if isinstance(node, ast.Attribute):
            if isinstance(node.value, ast.Name):
                runtime = self.runtime_module(node.value.id, scope)
                if runtime:
                    return f"{runtime}.{node.attr}"
            return f"{self.expr(node.value, scope)}.{node.attr}"
        if isinstance(node, ast.Call):
            return self.call(node, scope)
        if isinstance(node, ast.BinOp):
            return self.binop(node, scope)
        if isinstance(node, ast.UnaryOp):
            if isinstance(node.op, ast.Not):
                return f"!{self.test(node.operand, scope)}"
            if isinstance(node.op, ast.USub):
                if isinstance(node.operand, ast.Constant):
                    return "-" + self.expr(node.operand, scope)
                return f"$.neg({self.expr(node.operand, scope)})"
            if isinstance(node.op, ast.UAdd):
                return self.expr(node.operand, scope)
            self.error(node, "unary operator")
        if isinstance(node, ast.BoolOp):
            fn = "$.and" if isinstance(node.op, ast.And) else "$.or"
            values = [self.expr(v, scope) for v in node.values]
            out = values[-1]
            for v in reversed(values[:-1]):
                out = f"{fn}({v}, () => {out})"
            return out
        if isinstance(node, ast.Compare):
            return self.compare(node, scope)
        if isinstance(node, ast.IfExp):
            return (f"({self.test(node.test, scope)} ? "
                    f"{self.expr(node.body, scope)} : "
                    f"{self.expr(node.orelse, scope)})")
        if isinstance(node, ast.Subscript):
            value = self.expr(node.value, scope)
            if isinstance(node.slice, ast.Slice):
                parts = [
                    self.expr(p, scope) if p is not None else "undefined"
                    for p in (node.slice.lower, node.slice.upper,
                              node.slice.step)
                ]
                while parts and parts[-1] == "undefined":
                    parts.pop()
                return f"$.sl({', '.join([value] + parts)})"
            return f"$.gi({value}, {self.expr(node.slice, scope)})"
        if isinstance(node, ast.List):
            return "[" + ", ".join(self.element(e, scope)
                                   for e in node.elts) + "]"
        if isinstance(node, ast.Tuple):
            return "$.tuple(" + ", ".join(
                self.element(e, scope) for e in node.elts) + ")"
        if isinstance(node, ast.Set):
            return "$.set([" + ", ".join(
                self.element(e, scope) for e in node.elts) + "])"
        if isinstance(node, ast.Dict):
            items = []
            for k, v in zip(node.keys, node.values):
                if k is None:
                    items.append(f"...$.call({self.expr(v, scope)}, 'items')")
                else:
                    items.append(
                        f"[{self.expr(k, scope)}, {self.expr(v, scope)}]")
            if not items:
                return "new $.PyDict()"
            inner = ", ".join(items)
            if len(inner) > 100:
                inner = "\n  " + ",\n  ".join(items) + ",\n"
            return f"new $.PyDict([{inner}])"
        if isinstance(node, COMPREHENSIONS):
            return self.comprehension(node, scope)
        if isinstance(node, ast.JoinedStr):
            return self.fstring(node, scope)
        if isinstance(node, ast.Lambda):
            names, binding = self.signature(node.args, scope, False)
            inner = Scope(scope, "function", names)
            if not node.args.defaults and not node.args.vararg and not \
                    node.args.kwonlyargs and not node.args.kwarg:
                params = ", ".join(f"{ident(n)}: any" for n in names)
                return f"(({params}) => {self.expr(node.body, inner)})"
            bound = ", ".join(ident(n) for n in names)
            return (f"((...$a: any[]) => {{ let [{bound}] = {binding}; "
                    f"return {self.expr(node.body, inner)} }})")
        if isinstance(node, ast.Starred):
            self.error(node, "starred expression")
        self.error(node, type(node).__name__)

    def element(self, node, scope):
        if isinstance(node, ast.Starred):
            return f"...$.iter({self.expr(node.value, scope)})"
        return self.expr(node, scope)

    def runtime_module(self, name, scope):
        """``re``, ``json`` and the like, unless the code rebinds the name."""
        s = scope.lookup(name)
        if s is None:
            return None
        for stmt in self.tree.body:
            if isinstance(stmt, ast.Import):
                for a in stmt.names:
                    if (a.asname
                            or a.name) == name and a.name in RUNTIME_MODULES:
                        return RUNTIME_MODULES[a.name]
        return None

    def call_args(self, node, scope):
        args = [self.element(a, scope) for a in node.args]
        keywords = []
        spread = []
        for k in node.keywords:
            if k.arg is None:
                spread.append(f"...$.kwargs({self.expr(k.value, scope)})")
            else:
                keywords.append(
                    f"{json.dumps(k.arg)}: {self.expr(k.value, scope)}")
        if keywords or spread:
            args.append("$.kw({" + ", ".join(spread + keywords) + "})")
        return args

    def call(self, node, scope):
        func = node.func
        args = self.call_args(node, scope)
        joined = ", ".join(args)
        if isinstance(func, ast.Name):
            name = func.id
            local = scope.lookup(name)
            if local is None and name == "print":
                printed = [
                    f"$.strFloat({self.expr(a, scope)})" if self.is_float(
                        a, scope) else self.element(a, scope)
                    for a in node.args
                ]
                rest = args[len(node.args):]
                return f"$.print({', '.join(printed + rest)})"
            if local is None and name == "str" and len(node.args) == 1 and \
                    self.is_float(node.args[0], scope):
                return f"$.strFloat({args[0]})"
            if local is None and name == "super":
                self.error(node, "bare super()")
            target = self.name_ref(name, scope, func)
            if name in self.classes or (local is None and name in EXCEPTIONS):
                return f"new {target}({joined})"
            return f"{target}({joined})"
        if isinstance(func, ast.Attribute):
            value = func.value
            if isinstance(value, ast.Call) and isinstance(
                    value.func, ast.Name) and value.func.id == "super":
                return f"super.{func.attr}({joined})"
            if isinstance(value, ast.Name):
                runtime = self.runtime_module(value.id, scope)
                if runtime:
                    if func.attr == "JSONDecodeError":
                        return f"new {runtime}.{func.attr}({joined})"
                    return f"{runtime}.{func.attr}({joined})"
                local = scope.lookup(value.id)
                if local is None and value.id in BUILTINS:
                    return f"{BUILTINS[value.id]}.{func.attr}({joined})"
                if value.id in self.classes or (
                        local is not None and local.kind == "function"
                        and value.id in ("self", "cls")):
                    target = self.expr(value, scope)
                    return f"{target}.{func.attr}({joined})"
                if local is not None and local.kind == "module" and \
                        value.id in DATETIME:
                    return f"{self.expr(value, scope)}.{func.attr}({joined})"
            target = self.expr(value, scope)
            return "$.call(" + ", ".join(
                [target, json.dumps(func.attr)] + args) + ")"
        target = self.expr(func, scope)
        return f"({target})({joined})"

    def binop(self, node, scope):
        left, right = self.expr(node.left, scope), self.expr(node.right, scope)
        op = type(node.op)
        if op is ast.Add:
            strings = all(
                (isinstance(n, ast.Constant) and isinstance(n.value, str))
                or isinstance(n, ast.JoinedStr)
                for n in (node.left, node.right))
            if strings:
                return f"({left} + {right})"
            return f"$.add({left}, {right})"
        if op is ast.Mod and isinstance(
                node.left, ast.Constant) and isinstance(node.left.value, str):
            self.error(node, "%-formatting")
        fn = {
            ast.Sub: "$.sub",
            ast.Mult: "$.mul",
            ast.Div: "$.div",
            ast.FloorDiv: "$.floordiv",
            ast.Mod: "$.mod",
            ast.Pow: "$.pow",
            ast.BitOr: "$.bitor",
            ast.BitAnd: "$.bitand",
        }.get(op)
        if fn is None:
            self.error(node, "binary operator")
        return f"{fn}({left}, {right})"

    def compare(self, node, scope):
        parts = []
        left = node.left
        for op, right in zip(node.ops, node.comparators):
            if len(node.ops) > 1 and not isinstance(
                    right, (ast.Name, ast.Constant, ast.Attribute)) and \
                    right is not node.comparators[-1]:
                self.error(node, "chained comparison over an expression")
            parts.append(self.compare_one(left, op, right, scope))
            left = right
        if len(parts) == 1:
            return parts[0]
        return "(" + " && ".join(parts) + ")"

    def compare_one(self, left, op, right, scope):
        a, b = self.expr(left, scope), self.expr(right, scope)

        def none(n):
            return isinstance(n, ast.Constant) and n.value is None

        def string(n):
            return isinstance(n, ast.Constant) and isinstance(n.value, str)

        if isinstance(op, (ast.Is, ast.IsNot)):
            if none(right) or none(left):
                return f"({a} {'==' if isinstance(op, ast.Is) else '!='} {b})"
            return f"({a} {'===' if isinstance(op, ast.Is) else '!=='} {b})"
        if isinstance(op, ast.Eq):
            if string(left) or string(right):
                return f"({a} === {b})"
            return f"$.eq({a}, {b})"
        if isinstance(op, ast.NotEq):
            if string(left) or string(right):
                return f"({a} !== {b})"
            return f"$.ne({a}, {b})"
        fn = {
            ast.Lt: "$.lt",
            ast.LtE: "$.le",
            ast.Gt: "$.gt",
            ast.GtE: "$.ge",
            ast.In: "$.in_",
            ast.NotIn: "$.notIn",
        }[type(op)]
        return f"{fn}({a}, {b})"

    def comprehension(self, node, scope):
        inner = Scope(scope, "comprehension")
        for gen in node.generators:
            for n in ast.walk(gen.target):
                if isinstance(n, ast.Name):
                    inner.names.add(n.id)
        generator = isinstance(node, ast.GeneratorExp)
        result = self.fresh("r")
        declared = sorted(inner.names)
        lines = []
        if declared:
            lines.append("let " + ", ".join(f"{ident(n)}: any"
                                            for n in declared))
        if not generator:
            lines.append(f"const {result}: any[] = []")
        depth = 0
        first = True
        for gen in node.generators:
            iterable = self.expr(gen.iter, scope if first else inner)
            first = False
            item = self.fresh("v")
            lines.append(f"for (const {item} of $.iter({iterable})) {{")
            lines.extend(self.assign(gen.target, item, inner))
            for cond in gen.ifs:
                lines.append(f"if (!({self.test(cond, inner)})) continue")
            depth += 1
        if isinstance(node, ast.DictComp):
            value = (f"$.tuple({self.expr(node.key, inner)}, "
                     f"{self.expr(node.value, inner)})")
        else:
            value = self.expr(node.elt, inner)
        lines.append(
            f"yield {value}" if generator else f"{result}.push({value})")
        lines.append("}" * depth)
        body = " ".join(line if line.endswith(("{", "}")) else line + ";"
                        for line in lines)
        if generator:
            return f"(function* () {{ {body} }})()"
        if isinstance(node, ast.SetComp):
            return f"$.set((() => {{ {body} return {result} }})())"
        if isinstance(node, ast.DictComp):
            return f"$.dict((() => {{ {body} return {result} }})())"
        return f"(() => {{ {body} return {result} }})()"

    def fstring(self, node, scope):
        out = "`"
        for part in node.values:
            if isinstance(part, ast.Constant):
                out += part.value.replace("\\",
                                          "\\\\").replace("`", "\\`").replace(
                                              "${", "\\${")
            elif isinstance(part, ast.FormattedValue):
                value = self.expr(part.value, scope)
                conversion = chr(
                    part.conversion) if part.conversion > 0 else None
                spec = None
                if part.format_spec is not None:
                    spec = self.fstring(part.format_spec, scope)
                if spec is None and conversion is None:
                    if self.is_float(part.value, scope):
                        out += f"${{$.strFloat({value})}}"
                    else:
                        out += f"${{$.str({value})}}"
                else:
                    args = [value, spec or "undefined"]
                    if conversion:
                        args.append(json.dumps(conversion))
                    out += f"${{$.fv({', '.join(args)})}}"
            else:
                self.error(part, "f-string part")
        return out + "`"


class Build:

    def __init__(self):
        self.sources = vendored()
        self.by_module = {module_name(s): s for s in self.sources}
        self.trees = {
            module_name(s): ast.parse(source_path(s).read_text())
            for s in self.sources
        }

    def module_file(self, module):
        relative = self.by_module.get(module)
        if relative is None:
            return None
        return port_path(relative)

    def top_classes(self, module):
        return {
            n.name: n
            for n in self.trees[module].body if isinstance(n, ast.ClassDef)
        }

    def bindings(self, module):
        """Each module-level name bound to a class, and where that class is
        defined: (module, class)."""
        out = {}
        tree = self.trees[module]
        for node in tree.body:
            if isinstance(node, ast.ClassDef):
                out[node.name] = (module, node.name)
            elif isinstance(node, ast.ImportFrom) and node.module:
                source = node.module
                if node.level:
                    package = module.split(".")[:-node.level]
                    source = ".".join(package + [source])
                if source in self.trees:
                    for a in node.names:
                        resolved = self.bindings(source).get(a.name)
                        if resolved:
                            out[a.asname or a.name] = resolved
            elif isinstance(node, ast.Assign) and isinstance(
                    node.value, ast.Call) and isinstance(
                        node.value.func, ast.Name) and \
                    node.value.func.id == "load_peer_grader":
                peer = f"tasks.{node.value.args[0].value}.grader"
                out[node.targets[0].id] = (peer, self.peer_class(peer))
        return out

    def is_class(self, module, name):
        return name in self.bindings(module) if module in self.trees else False

    def grader_subclass(self, module, name):
        """Whether the class ``module.name`` derives from AbstractGrader."""
        if (module, name) == ("claw_eval.graders.base", "AbstractGrader"):
            return True
        node = self.top_classes(module).get(name)
        if node is None:
            return False
        names = self.bindings(module)
        for base in node.bases:
            if isinstance(base, ast.Name) and base.id in names:
                if self.grader_subclass(*names[base.id]):
                    return True
        return False

    def peer_class(self, module):
        """What ``load_peer_grader`` returns for ``module``: the first
        AbstractGrader subclass among its classes, by attribute name."""
        candidates = sorted(
            (name, where) for name, where in self.bindings(module).items()
            if where != ("claw_eval.graders.base",
                         "AbstractGrader") and self.grader_subclass(*where))
        if not candidates:
            raise Unsupported(f"no grader class in {module}")
        name, where = candidates[0]
        if where[0] != module:
            raise Unsupported(f"{module}'s peer class {name} is imported")
        return name

    def task_class(self, module):
        """What upstream's registry instantiates: the first AbstractGrader
        subclass defined in ``module``, by name."""
        names = sorted(n for n in self.top_classes(module)
                       if self.grader_subclass(module, n))
        if not names:
            raise Unsupported(f"no grader class in {module}")
        return names[0]

    def grade_params(self, module, name):
        """The parameters of the ``grade`` the class ``module.name`` has."""
        node = self.top_classes(module).get(name)
        if node is None:
            raise Unsupported(f"no class {name} in {module}")
        for stmt in node.body:
            if isinstance(stmt, ast.FunctionDef) and stmt.name == "grade":
                a = stmt.args
                return [x.arg for x in a.posonlyargs + a.args + a.kwonlyargs]
        names = self.bindings(module)
        for base in node.bases:
            if isinstance(base, ast.Name) and base.id in names:
                return self.grade_params(*names[base.id])
        raise Unsupported(f"no grade method for {module}.{name}")

    def files(self):
        out = {}
        for relative in self.sources:
            module = Module(self, relative)
            module.declared = set()
            out[module.out] = module.compile()
        tasks = json.loads((REFERENCE / "tasks.json").read_text())
        lines = [
            "// Generated by graders/build.py; do not edit.",
            "import type { TaskData } from '../models.ts'",
        ]
        entries = []
        media = []
        for task in sorted(tasks):
            module = f"tasks.{task}.grader"
            if module in self.trees:
                cls = self.task_class(module)
                takes = "media_events" in self.grade_params(module, cls)
                if task in WITHHELD and WITHHELD[task] != (cls, takes):
                    raise Unsupported(f"{task}'s grader is {cls}: update "
                                      "WITHHELD")
            elif task in WITHHELD:
                cls, takes = WITHHELD[task]
            else:
                raise Unsupported(f"no reference grader for {task}")
            entries.append(f"  {json.dumps(task)}: {json.dumps(cls)},")
            if takes:
                media.append(task)
        lines += [
            "",
            "/** Each task's grader class, as upstream's registry picks it:",
            " * the first by name its module defines. */",
            "export const GRADERS: Record<string, string> = {",
            *entries,
            "}",
            "",
            "/** A task's module, loaded when it is graded: three are written",
            " * at setup (WITHHELD, in build.py). */",
            "export const load = (task: string): Promise<any> => "
            "import(`../../${task}/grader.ts`)",
            "",
            "/** The tasks whose grade takes `media_events`, which upstream's",
            " * runner passes where the signature has it. */",
            "export const MEDIA = new Set(" + json.dumps(media, indent=2) +
            ")",
            "",
            "/** Each task's definition, as its task.yaml gives it. */",
            "export const TASKS: Record<string, TaskData> = " +
            json.dumps(tasks, ensure_ascii=False, indent=2, sort_keys=True),
            "",
        ]
        out["graders/port/registry.ts"] = "\n".join(lines)
        return out


def pinned(relative, manifest):
    """An upstream source's bytes, checked against its pin."""
    data = (UPSTREAM / relative).read_bytes()
    digests = {
        d["sources"][relative]
        for d in manifest["tasks"].values() if relative in d["sources"]
    }
    if digests != {hashlib.sha256(data).hexdigest()}:
        raise SystemExit(f"{relative} changed upstream; review it")
    return data


def check_pins(manifest):
    """Fail unless each reference/ source is the bytes its pin names."""
    pins = {
        relative: digest
        for d in manifest["tasks"].values()
        for relative, digest in d["sources"].items()
    }
    paths = [p for p in REFERENCE.rglob("*") if p.name != "tasks.json"]
    for path in sorted(paths + list(DATASET.glob("*/grader.py"))):
        if not path.is_file():
            continue
        if hashlib.sha256(path.read_bytes()).hexdigest() != pins.get(
                upstream_path(path)):
            raise SystemExit(f"{path.relative_to(DATASET)} is not its pin in "
                             "manifest.json; run graders/build.py --vendor")


def withhold():
    """Write the withheld graders' reference copies from the fetch."""
    manifest = json.loads(MANIFEST.read_text())
    for task in WITHHELD:
        relative = f"tasks/{task}/grader.py"
        source_path(relative).write_bytes(pinned(relative, manifest))


def migrate():
    """Move the withheld graders a checkout fetched before each task's grader
    moved to its task's directory. They are gitignored, so a pull leaves them
    at ``reference/tasks/<task>/`` and ``port/tasks/<task>.ts``. Returns the
    tasks whose reference moved; their ports are written again."""
    moved = []
    for task in WITHHELD:
        old = REFERENCE / "tasks" / task
        if (old / "grader.py").is_file() and not (DATASET / task /
                                                  "grader.py").exists():
            (old / "grader.py").rename(DATASET / task / "grader.py")
            moved.append(task)
        shutil.rmtree(old, ignore_errors=True)
        (PORT / "tasks" / f"{task}.ts").unlink(missing_ok=True)
    for stale in (REFERENCE / "tasks", PORT / "tasks"):
        if stale.is_dir() and not any(stale.iterdir()):
            stale.rmdir()
    return moved


def vendor():
    """Copy the pinned sources from the fetched checkout into reference/."""
    import yaml
    manifest = json.loads(MANIFEST.read_text())
    tasks = {}
    wanted = set(SHARED)
    for task, definition in manifest["tasks"].items():
        for relative, digest in definition["sources"].items():
            data = (UPSTREAM / relative).read_bytes()
            if hashlib.sha256(data).hexdigest() != digest:
                raise SystemExit(f"{relative} changed upstream; review it")
            if relative.endswith("grader.py"):
                wanted.add(relative)
        config = yaml.safe_load(
            (UPSTREAM / "tasks" / task / "task.yaml").read_text())
        tasks[task] = {
            "task_id":
            config["task_id"],
            "task_name":
            config["task_name"],
            "prompt": {
                "text": config["prompt"]["text"],
                "language": config["prompt"].get("language", "zh"),
            },
            "judge_rubric":
            config.get("judge_rubric", ""),
            "services": [{
                "name": s["name"],
                "reset_endpoint": s.get("reset_endpoint"),
            } for s in config.get("services", [])],
            "tools": [{
                "name": t["name"]
            } for t in config.get("tools", [])],
            "tool_endpoints": [{
                "tool_name": e["tool_name"],
                "url": e["url"]
            } for e in config.get("tool_endpoints", [])],
        }
    if REFERENCE.exists():
        shutil.rmtree(REFERENCE)
    for stale in DATASET.glob("*/grader.py"):
        stale.unlink()
    for relative in sorted(wanted):
        target = source_path(relative)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(UPSTREAM / relative, target)
    (REFERENCE / "tasks.json").write_text(
        json.dumps(tasks, ensure_ascii=False, indent=1, sort_keys=True) + "\n")


def ports():
    """The ports on disk, as paths under the dataset."""
    return [
        p.relative_to(DATASET).as_posix()
        for p in [*PORT.rglob("*.ts"), *DATASET.glob("*/grader.ts")]
    ]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--vendor", action="store_true")
    parser.add_argument("--withheld",
                        action="store_true",
                        help="write the withheld graders from the fetch")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    moved = migrate()
    if args.vendor:
        vendor()
    if args.withheld:
        withhold()
    try:
        files = Build().files()
    except Unsupported as exc:
        raise SystemExit(f"cannot port: {exc}")
    for task in moved:
        (DATASET / task / "grader.ts").write_text(files[f"{task}/grader.ts"])
    if args.check:
        check_pins(json.loads(MANIFEST.read_text()))
        # A withheld grader's port is checked where it was written.
        built = set(files)
        current = {
            p: (DATASET / p).read_text()
            for p in ports() if p in built or not withheld(p)
        }
        if current != files:
            stale = sorted(
                set(current) ^ set(files) | {
                    k
                    for k in files.keys() & current.keys()
                    if files[k] != current[k]
                })
            raise SystemExit("Claw-Eval port drift; run graders/build.py: " +
                             ", ".join(stale[:10]))
        return
    for path in ports():
        # A withheld grader's port stays until its reference is back.
        if path in files or not withheld(path):
            (DATASET / path).unlink()
    for relative, text in files.items():
        target = DATASET / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text)
    print(f"wrote {len(files)} ports under {DATASET}", file=sys.stderr)


if __name__ == "__main__":
    main()
