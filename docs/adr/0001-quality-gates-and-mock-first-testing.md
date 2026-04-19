# ADR-0001: Quality Gates and Mock-first Testing

- **Status**: Accepted
- **Date**: 2026-04-19

## Context

The project integrates with external systems (Jenkins, GitLab, containers, webhooks).  
Direct dependency on live infrastructure makes CI flaky, slow, and hard to reproduce.

At the same time, we need stronger stability guarantees before merge and during nightly runs.

## Decision

1. Use **mock-first CI quality gates** for pre-merge and nightly checks.
2. Split checks into:
   - **Canary stage**: very fast smoke against mocked integrations.
   - **Regression stage**: wider mocked suite.
3. Keep tests independent from:
   - real Jenkins/GitLab instances
   - real containers
   - pre-existing external databases
4. Add nightly auto-alerting by creating a GitHub issue when regression failures are detected.

## Consequences

### Positive

- deterministic CI signal
- faster feedback on pull requests
- easier local reproduction
- lower operational risk from integration outages

### Negative / Trade-offs

- mocked tests cannot fully replace real-production behavior
- requires maintenance of test doubles and fixtures
- nightly issue alerts can be noisy if failures are not triaged quickly

## Implementation Notes

- `premerge-smoke.yml` runs canary then smoke mocked tests.
- `nightly-regression.yml` runs mocked regression and publishes JUnit artifact.
- nightly workflow opens an issue if failing/error tests are present.
