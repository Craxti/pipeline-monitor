# Security Policy

## Supported versions

This repository is an application (not a versioned library on PyPI). Security fixes are applied on the **default branch** and, when we publish them, in **patch Git tags** cut from that line.

| Scope | Security updates |
| ----- | ---------------- |
| Latest commit on the default branch (`main`) | Yes |
| Older commits, feature branches, or forks | No — deploy from `main` or a current tag |
| Untagged / ad-hoc deployments | Not supported — pin to a commit or tag and upgrade regularly |

When we start tagging releases (e.g. `v1.2.3`), we will extend this table with explicit supported release lines.

## Reporting a vulnerability

**Please do not open a public issue** for undisclosed security problems (credentials, RCE, auth bypass, SSRF, etc.).

1. **Preferred:** use [GitHub private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability) for this repository (button **Report a vulnerability** on the **Security** tab), if the maintainers have enabled it.
2. **Alternative:** contact the maintainers through a **private** channel they publish for this project (e.g. security email or internal messenger). Do not send exploit details only in public chat.

### For maintainers: open a draft security advisory

Repository collaborators with **admin** or **security manager** access can [open a draft security advisory](https://github.com/Craxti/pipeline-monitor/security/advisories/new) for coordinated disclosure after triage.

**In the GitHub UI:** **Security** tab → **Advisories** → **Report a vulnerability** or **New draft security advisory** (wording may vary) — or use the direct link above.

Drafts stay **private** until you publish them; you can open a PR from the advisory to land the fix and request CVE assignment when publishing, if applicable.

### What to include

- A short description of the issue and affected component (e.g. web UI, API, collector).
- Steps to reproduce or a proof-of-concept **without** live attacks on production systems you do not own.
- Affected version/commit or branch, if known.

### What to expect

- We aim to acknowledge reports within **a few business days** (no SLA for an unfunded OSS-style project).
- We will coordinate on severity, fix timeline, and disclosure (e.g. GitHub Security Advisory) when a fix is ready.
- If the report is out of scope (e.g. misconfiguration without a code bug), we will say so and may suggest hardening steps.

## Scope notes

- **Dependency vulnerabilities:** use your normal supply-chain process (`pip audit`, Dependabot, etc.). We still welcome reports if a **direct** dependency of this repo has a critical issue with a clear upgrade path.
- **Self-hosted deployments:** you are responsible for network exposure, TLS, secrets in `config.yaml` / environment variables, and firewall rules.
