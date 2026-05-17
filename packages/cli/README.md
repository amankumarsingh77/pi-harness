# @pi-harness/cli

CLI for bootstrapping and running pi-harness in an existing git repository.

```bash
npm install -g @pi-harness/cli
pi-harness init
pi-harness dev
```

`init` writes local harness config, example environment files, and a generated
compose file. `dev` runs doctor checks, starts local infrastructure, applies
migrations, starts the orchestrator, and serves the dashboard.

See the root README for the full workflow and architecture.
