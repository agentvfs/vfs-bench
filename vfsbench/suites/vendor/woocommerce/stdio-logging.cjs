// The pinned server emits startup notices with console.log. Keep stdout for MCP frames.
console.log = console.error.bind(console);
