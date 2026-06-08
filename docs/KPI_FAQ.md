# KPI FAQ

## Why does "Average recovery" show "—"?

It means there are no matched `build_fail -> build_recovered` pairs in the selected period/filter.

## Why can "Most problematic jobs" look unchanged across instances?

Possible reasons:

1. Only one instance has enough data in selected period.
2. Historical data row is legacy and lacks per-instance job slices.
3. Source/instance filters are inconsistent (instance implies source).

## Which filters affect KPI cards?

For Trends KPI cards:

- `source`
- `instance`
- selected period (`days`)

Filters like `tstatus`, `svstatus`, and Incidents tab state do not alter KPI computations.

## Service incidents vs CI incident bundle

- **Service incidents** (`/api/service-incidents`) come from log intelligence anomalies on Docker/external services.
- **CI incident bundle** (`/api/incident*`) aggregates current snapshot build/test failures for export — separate from service incidents.

## How to verify KPI data path quickly?

1. Open browser dev tools and inspect request:
   - `/api/trends/history-summary?days=...&source=...&instance=...`
2. Compare response payload fields:
   - `crash_frequency_per_day`
   - `avg_recovery_minutes`
   - `recovery_samples`
   - `most_problematic_jobs`

## Can KPI data be trusted without live Jenkins/GitLab?

Yes for application logic verification.  
Mock-based tests validate parsing, aggregation, and filter contracts.  
Production parity still requires occasional staging verification.
