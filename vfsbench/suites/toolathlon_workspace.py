from dataclasses import dataclass, replace


@dataclass(frozen=True)
class WorkspaceDefaults:
    clis: tuple[str, ...] = ()
    python: bool = True

    def bind(self, environment):
        """Bind the built-ins to this trial's service settings."""
        workspace = dict(environment.workspace)
        settings = workspace.get("clis", {})
        if unexpected := settings.keys() - set(self.clis):
            raise ValueError(
                f"Undeclared Toolathlon CLI settings: {sorted(unexpected)}")
        workspace["clis"] = {
            name: {
                "cli": name,
                "machine": "in_process",
                **settings.get(name, {})
            }
            for name in self.clis
        }
        return replace(environment, workspace=workspace, python=self.python)


PDF = ("pdftotext", "pdfinfo")
WORKSPACES = {
    "ab-testing": WorkspaceDefaults(),
    "academic-warning": WorkspaceDefaults(),
    "apply-phd-email": WorkspaceDefaults(("git", )),
    "arrange-workspace": WorkspaceDefaults((*PDF, "office")),
    "cooking-guidance": WorkspaceDefaults(python=False),
    "course-assistant": WorkspaceDefaults(("himalaya", "office", "git")),
    "course-schedule": WorkspaceDefaults(("office", *PDF)),
    "courses-ta-hws": WorkspaceDefaults(("office", )),
    "detect-revised-terms": WorkspaceDefaults(PDF),
    "dietary-health": WorkspaceDefaults(("office", "git")),
    "excel-data-transformation": WorkspaceDefaults(("office", )),
    "excel-market-research": WorkspaceDefaults(("office", )),
    "flagged-transactions": WorkspaceDefaults(("office", )),
    "game-statistics": WorkspaceDefaults(),
    "git-repo": WorkspaceDefaults(("gh", *PDF)),
    "imagenet": WorkspaceDefaults(PDF),
    "interview-report": WorkspaceDefaults(python=False),
    "inventory-sync": WorkspaceDefaults(),
    "live-transactions": WorkspaceDefaults(),
    "machine-operating": WorkspaceDefaults(("office", )),
    "music-analysis": WorkspaceDefaults(("gws", "office")),
    "nhl-b2b-analysis": WorkspaceDefaults(("gws", )),
    "notion-personal-website": WorkspaceDefaults(python=False),
    "paper-checker": WorkspaceDefaults(),
    "personal-website-construct": WorkspaceDefaults(("gh", )),
    "ppt-analysis": WorkspaceDefaults(python=False),
    "price-comparison": WorkspaceDefaults(PDF),
    "privacy-desensitization": WorkspaceDefaults(),
    "reimbursement-form-filler": WorkspaceDefaults((*PDF, "office")),
    "sales-accounting": WorkspaceDefaults(("office", )),
    "set-conf-cr-ddl": WorkspaceDefaults(("himalaya", )),
    "student-interview": WorkspaceDefaults(("himalaya", ), python=False),
    "sync-todo-to-readme": WorkspaceDefaults(("gh", )),
    "update-material-inventory": WorkspaceDefaults(),
    "wandb-best-score": WorkspaceDefaults(),
    "wandb-shortest-length": WorkspaceDefaults(),
    "woocommerce-new-welcome": WorkspaceDefaults(("himalaya", )),
    "woocommerce-update-cover": WorkspaceDefaults(),
}
