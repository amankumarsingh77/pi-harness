# Security Policy

## Supported Versions

pi-harness is pre-1.0. Security fixes target the latest published release and
the `main` branch.

## Reporting a Vulnerability

Please do not open a public issue for a suspected vulnerability.

Email the maintainer at the address listed on the GitHub profile for
`amankumarsingh77`, or open a private GitHub security advisory when that option
is available.

Useful details:

- Affected package or app.
- Steps to reproduce.
- Whether real credentials, worktrees, or repository contents can be exposed.
- Any logs or screenshots with secrets redacted.

## Handling Secrets

Never commit `.env`, `.env.local`, `.env.harness`, provider keys, OAuth tokens,
or generated agent session state. The repository includes example env files for
local setup only.
