"""A Harbor environment served from a Mirage workspace, not a container,
verifiers that run outside it, in a microVM, or in it with state files the
agent never sees, and Codex and Claude Code on the host with their tools in
the workspace."""
from vfsbench_harbor.agents import ClaudeCode, Codex
from vfsbench_harbor.environment import MirageEnvironment
from vfsbench_harbor.microsandbox import MicrosandboxVerifier
from vfsbench_harbor.verifier import WorkspaceVerifier

__all__ = ["ClaudeCode", "Codex", "MirageEnvironment", "MicrosandboxVerifier",
           "WorkspaceVerifier"]
