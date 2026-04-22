"""Merge Jenkins raw test rows (build + Allure + console) into ``jenkins_unified``."""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

from clients.jenkins_client import JenkinsClient

_JENKINS_MERGE_SOURCES = frozenset({"jenkins_build", "jenkins_allure", "jenkins_console"})


def _canonical_rep_same_build(jobs: list[str]) -> dict[str, str]:
    """Map each job string to a canonical representative (longest name in its equivalence class)."""
    uniq: list[str] = []
    for j in jobs:
        j = (j or "").strip()
        if j and j not in uniq:
            uniq.append(j)
    if not uniq:
        return {}
    parent = {j: j for j in uniq}

    def root(x: str) -> str:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: str, b: str) -> None:
        ra, rb = root(a), root(b)
        if ra == rb:
            return
        if len(ra) >= len(rb):
            parent[rb] = ra
        else:
            parent[ra] = rb

    for i, a in enumerate(uniq):
        for b in uniq[i + 1 :]:
            if JenkinsClient.job_names_equivalent(a, b):
                union(a, b)
    canon_by_root: dict[str, str] = {}
    for j in uniq:
        r = root(j)
        cur = canon_by_root.get(r)
        if cur is None or len(j) > len(cur):
            canon_by_root[r] = j
    return {j: canon_by_root[root(j)] for j in uniq}


def _jenkins_test_job_canonical_map(rows: list[Any]) -> dict[tuple[str, str, int], str]:
    """(instance, job, build_number) -> canonical job for grouping unified rows."""
    from collections import defaultdict

    by_inst_bn: dict[tuple[str, int], list[str]] = defaultdict(list)
    for t in rows:
        src = (getattr(t, "source", "") or "").lower()
        if src not in _JENKINS_MERGE_SOURCES:
            continue
        inst = (getattr(t, "source_instance", None) or "").strip()
        if src == "jenkins_build":
            job = (getattr(t, "suite", None) or getattr(t, "test_name", "") or "").strip()
        else:
            job = (getattr(t, "suite", None) or "").strip() or (getattr(t, "test_name", "") or "").strip()
        bn_raw = getattr(t, "build_number", None)
        try:
            bn = int(bn_raw) if bn_raw is not None else -1
        except (TypeError, ValueError):
            bn = -1
        if bn < 0 or not job:
            continue
        by_inst_bn[(inst, bn)].append(job)

    flat: dict[tuple[str, str, int], str] = {}
    for (inst, bn), job_list in by_inst_bn.items():
        rep = _canonical_rep_same_build(job_list)
        for j, cj in rep.items():
            flat[(inst, j, bn)] = cj
    return flat


def _norm_scenario_key(name: str) -> str:
    s = (name or "").strip()
    s = re.sub(r"^№\d+\s*", "", s)
    if "::" in s:
        s = s.split("::")[-1]
    return re.sub(r"\s+", "_", s.strip().lower())


def _status_rank(st: str) -> int:
    s = (st or "").strip().lower()
    mapping = {
        "error": 40,
        "failed": 30,
        "failure": 30,
        "xfailed": 28,
        "unknown": 15,
        "pending": 10,
        "skipped": 8,
        "passed": 0,
    }
    return mapping.get(s, 12)


def _pick_worse_status(*statuses: str) -> str:
    vals = [x for x in statuses if x]
    if not vals:
        return "unknown"
    return max(vals, key=_status_rank)


def _combine_messages(allure_msg: str | None, console_msg: str | None) -> str | None:
    parts: list[str] = []
    a = (allure_msg or "").strip()
    c = (console_msg or "").strip()
    if a:
        parts.append(f"[Allure]\n{a}")
    if c:
        parts.append(f"[Console]\n{c}")
    if not parts:
        return None
    return "\n\n".join(parts)


def _fuzzy_scenario_match(a: str, b: str) -> bool:
    na = _norm_scenario_key(a)
    nb = _norm_scenario_key(b)
    if not na or not nb:
        return False
    if na == nb:
        return True
    if len(na) >= 4 and na in nb:
        return True
    if len(nb) >= 4 and nb in na:
        return True
    return False


def _lookup_build(snapshot: Any, inst: str, job: str, bn: int) -> Any | None:
    for b in getattr(snapshot, "builds", None) or []:
        if (getattr(b, "source", "") or "").lower() != "jenkins":
            continue
        bi = (getattr(b, "source_instance", None) or "").strip()
        if bi != (inst or "").strip():
            continue
        bj = getattr(b, "job_name", "") or ""
        bb = getattr(b, "build_number", None)
        if bb is None:
            continue
        try:
            n = int(bb)
        except (TypeError, ValueError):
            continue
        if n != int(bn):
            continue
        if bj == job or JenkinsClient.job_names_equivalent(bj, job):
            return b
    return None


def _group_max_ts(bucket: dict[str, list[Any]]) -> Any:
    mx = None
    for lst in bucket.values():
        for r in lst:
            ts = getattr(r, "timestamp", None)
            if ts is None:
                continue
            if mx is None or ts > mx:
                mx = ts
    return mx or datetime.min.replace(tzinfo=timezone.utc)


def merge_jenkins_unified_tests(snapshot: Any, *, TestRecord: type, logger: Any | None = None) -> int:
    """Strip prior unified + raw Jenkins test rows; append merged ``jenkins_unified`` rows.

    Returns number of unified rows produced.
    """
    if logger is None:
        import logging

        logger = logging.getLogger(__name__)

    tests = list(getattr(snapshot, "tests", None) or [])
    stripped = [t for t in tests if (getattr(t, "source", "") or "").lower() != "jenkins_unified"]
    merge_bucket = [t for t in stripped if (getattr(t, "source", "") or "").lower() in _JENKINS_MERGE_SOURCES]
    others = [t for t in stripped if (getattr(t, "source", "") or "").lower() not in _JENKINS_MERGE_SOURCES]

    if not merge_bucket:
        snapshot.tests = others
        return 0

    job_canon = _jenkins_test_job_canonical_map(merge_bucket)
    groups: dict[tuple[str, str, int], dict[str, list[Any]]] = {}
    for t in merge_bucket:
        src = (getattr(t, "source", "") or "").lower()
        inst = (getattr(t, "source_instance", None) or "").strip()
        if src == "jenkins_build":
            job = (getattr(t, "suite", None) or getattr(t, "test_name", "") or "").strip()
        else:
            job = (getattr(t, "suite", None) or "").strip() or (getattr(t, "test_name", "") or "").strip()
        bn_raw = getattr(t, "build_number", None)
        try:
            bn = int(bn_raw) if bn_raw is not None else -1
        except (TypeError, ValueError):
            bn = -1
        cjob = job_canon.get((inst, job, bn), job)
        key = (inst, cjob, bn)
        if key not in groups:
            groups[key] = {"synth": [], "allure": [], "console": []}
        bucket = groups[key]
        if src == "jenkins_build":
            bucket["synth"].append(t)
        elif src == "jenkins_allure":
            bucket["allure"].append(t)
        else:
            bucket["console"].append(t)

    unified_out: list[Any] = []
    for key in sorted(groups.keys(), key=lambda k: _group_max_ts(groups[k]), reverse=True):
        inst, job, bn = key
        bucket = groups[key]
        synths = bucket["synth"]
        allures = bucket["allure"]
        consoles = list(bucket["console"])
        brec = _lookup_build(snapshot, inst, job, bn) if bn >= 0 else None
        started = getattr(brec, "started_at", None) if brec else None
        dur = getattr(brec, "duration_seconds", None) if brec else None
        inst_fallback = inst
        if allures:
            inst_fallback = (getattr(allures[0], "source_instance", None) or inst or "").strip()
        elif consoles:
            inst_fallback = (getattr(consoles[0], "source_instance", None) or inst or "").strip()
        elif synths:
            inst_fallback = (getattr(synths[0], "source_instance", None) or inst or "").strip()
        if not inst_fallback and brec is not None:
            inst_fallback = (getattr(brec, "source_instance", None) or "").strip()

        if started is None or dur is None:
            for r in allures + consoles + synths:
                if started is None and getattr(r, "timestamp", None):
                    started = r.timestamp
                if dur is None and getattr(r, "duration_seconds", None) is not None:
                    dur = r.duration_seconds

        synth_job = synths[0] if synths else None
        used_console: set[int] = set()

        if allures:
            for ar in allures:
                match_c = None
                for cr in consoles:
                    if id(cr) in used_console:
                        continue
                    if _fuzzy_scenario_match(getattr(ar, "test_name", "") or "", getattr(cr, "test_name", "") or ""):
                        match_c = cr
                        used_console.add(id(cr))
                        break
                am = getattr(ar, "failure_message", None)
                cm = getattr(match_c, "failure_message", None) if match_c else None
                msg = _combine_messages(am, cm)
                st = _pick_worse_status(
                    str(getattr(ar, "status", "") or ""),
                    str(getattr(match_c, "status", "") or "") if match_c else "",
                )
                out_bn = bn if bn >= 0 else getattr(ar, "build_number", None)
                row_started = (getattr(brec, "started_at", None) if brec else None) or getattr(
                    ar, "timestamp", None
                )
                row_dur = dur if dur is not None else getattr(ar, "duration_seconds", None)
                unified_out.append(
                    TestRecord(
                        source="jenkins_unified",
                        source_instance=inst_fallback or None,
                        suite=job,
                        test_name=str(getattr(ar, "test_name", "") or ""),
                        status=st,
                        duration_seconds=row_dur,
                        failure_message=msg,
                        timestamp=row_started,
                        file_path=getattr(ar, "file_path", None),
                        build_number=out_bn,
                        allure_uid=getattr(ar, "allure_uid", None),
                        allure_description=getattr(ar, "allure_description", None),
                        allure_attachments=getattr(ar, "allure_attachments", None),
                    )
                )
            for cr in consoles:
                if id(cr) in used_console:
                    continue
                msg = _combine_messages(None, getattr(cr, "failure_message", None))
                st = str(getattr(cr, "status", "") or "unknown")
                out_bn = bn if bn >= 0 else getattr(cr, "build_number", None)
                row_started = (getattr(brec, "started_at", None) if brec else None) or getattr(
                    cr, "timestamp", None
                )
                row_dur = dur if dur is not None else getattr(cr, "duration_seconds", None)
                au: Any | None = None
                ad: Any | None = None
                aat: Any | None = None
                cr_n = _norm_scenario_key(str(getattr(cr, "test_name", "") or ""))
                if cr_n:
                    mates = [
                        ar
                        for ar in allures
                        if cr_n == _norm_scenario_key(str(getattr(ar, "test_name", "") or ""))
                    ]
                    # Fallback: same fuzzy matching logic as pairing step.
                    # If this console row remained unmatched but has exactly one
                    # fuzzy allure candidate in the same build, borrow Allure meta
                    # so ``real``/``jenkins_unified`` UI can show Description/Screenshots.
                    if not mates:
                        mates = [
                            ar
                            for ar in allures
                            if _fuzzy_scenario_match(
                                str(getattr(cr, "test_name", "") or ""),
                                str(getattr(ar, "test_name", "") or ""),
                            )
                        ]
                    if len(mates) == 1:
                        ar0 = mates[0]
                        au = getattr(ar0, "allure_uid", None)
                        ad = getattr(ar0, "allure_description", None)
                        aat = getattr(ar0, "allure_attachments", None)
                unified_out.append(
                    TestRecord(
                        source="jenkins_unified",
                        source_instance=inst_fallback or None,
                        suite=job,
                        test_name=str(getattr(cr, "test_name", "") or ""),
                        status=st,
                        duration_seconds=row_dur,
                        failure_message=msg,
                        timestamp=row_started,
                        build_number=out_bn,
                        allure_uid=au,
                        allure_description=ad,
                        allure_attachments=aat,
                    )
                )
        elif consoles:
            for cr in consoles:
                msg = _combine_messages(None, getattr(cr, "failure_message", None))
                st = str(getattr(cr, "status", "") or "unknown")
                out_bn = bn if bn >= 0 else getattr(cr, "build_number", None)
                row_started = (getattr(brec, "started_at", None) if brec else None) or getattr(
                    cr, "timestamp", None
                )
                row_dur = dur if dur is not None else getattr(cr, "duration_seconds", None)
                unified_out.append(
                    TestRecord(
                        source="jenkins_unified",
                        source_instance=inst_fallback or None,
                        suite=job,
                        test_name=str(getattr(cr, "test_name", "") or ""),
                        status=st,
                        duration_seconds=row_dur,
                        failure_message=msg,
                        timestamp=row_started,
                        build_number=out_bn,
                    )
                )
        elif synth_job is not None:
            out_bn = bn if bn >= 0 else getattr(synth_job, "build_number", None)
            row_started = (getattr(brec, "started_at", None) if brec else None) or getattr(
                synth_job, "timestamp", None
            )
            row_dur = dur if dur is not None else getattr(synth_job, "duration_seconds", None)
            unified_out.append(
                TestRecord(
                    source="jenkins_unified",
                    source_instance=inst_fallback or None,
                    suite=job,
                    test_name=str(getattr(synth_job, "test_name", "") or job),
                    status=str(getattr(synth_job, "status", "") or "unknown"),
                    duration_seconds=row_dur,
                    failure_message=getattr(synth_job, "failure_message", None),
                    timestamp=row_started,
                    build_number=out_bn,
                )
            )

    snapshot.tests = others + unified_out
    logger.info("Jenkins unified tests: merged %d raw rows -> %d unified rows", len(merge_bucket), len(unified_out))
    return len(unified_out)
