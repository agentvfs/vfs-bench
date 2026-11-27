def execution_status(task, config):
    """Describe whether the installed suite adapter has the task's service
    implementations."""
    if config.environment != "suite":
        from ..runtime import _installed_environment

        _installed_environment(config.environment)
        return "custom environment", config.environment
    suite = task.manifest["dataset"]
    if suite == "complexmcp":
        return "available", ""
    if suite == "mcpatlas":
        from .mcpatlas import requirements

        missing = requirements(task, config)
        return ("needs providers",
                ", ".join(missing)) if missing else ("available", "")
    if suite == "toolathlon":
        from .toolathlon import (COOKING, SUPPORTED, WOOCOMMERCE, bigquery,
                                 calendar_tasks, documents)

        if task.id in SUPPORTED:
            if task.id == "notion-personal-website":
                return "available", ("Docker (Mirage Notion and "
                                     "upstream Word MCP)")
            if task.id == "update-material-inventory":
                return "available", (
                    "WooCommerce (Docker WordPress and MySQL, Node MCP), "
                    "Google Sheets (Mirage mock, uv)")
            if task.id == "woocommerce-new-welcome":
                return "available", (
                    "WooCommerce (Docker WordPress and MySQL, Node MCP), "
                    "BigQuery (Docker), Mirage mail mock")
            if task.id == "apply-phd-email":
                return "available", ("Docker (private Mirage mail, email, "
                                     "memory and PDF MCP servers)")
            if task.id == "course-schedule":
                return "available", "Node (pinned memory MCP)"
            if task.id in bigquery.TASKS:
                return "available", "Docker (Google Cloud emulators)"
            if task.id in documents.MANIFESTS:
                return "available", "Docker (pinned document servers)"
            if task.id in WOOCOMMERCE:
                return "available", "Docker (WordPress and MySQL), Node MCP"
            if task.id in COOKING:
                return "available", "locked HowToCook npm service"
            if task.id in calendar_tasks.MANIFESTS:
                return "available", "Mirage Calendar and mail mocks"
            if task.id == "course-assistant":
                return "available", ("Mirage mail mock and locked npm "
                                     "dependencies")
            return "available", ""
        services = task.manifest["upstream_tools"]["needed_mcp_servers"]
        return "needs adapter", ", ".join(services)
    return "needs adapter", suite
