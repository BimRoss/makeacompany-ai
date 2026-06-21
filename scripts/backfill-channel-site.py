#!/usr/bin/env python3
"""
Backfill the `channel_site:<channel_id>` Redis hash for the 65 user channels
Joanne provisioned before claude-code-joanne PR #258 and claude-code-ross PR
#437 added forward writes. See makeacompany-ai#573 for the design.

Heuristics (in priority order):

  Tier 1: slug equality. Channel `endo` -> `endo.makeacompany.ai`. Also
          tolerates the hyphen-strip variant: `braces-for-feet` ->
          `bracesforfeet.makeacompany.ai`. Highest-confidence; auto-written
          on --apply.

  Tier 2: time-window context. For channels with no slug match, the report
          lists candidate subdomains whose DNS `created_on` falls in the N
          days following channel creation. NOT auto-written — empirically
          the window heuristic produces false positives even at 1d
          (unrelated repos created concurrently). The report exists so a
          human can confirm a real link by eye and run a manual HSET.

Resolution outcomes per channel:
  - resolved      slug-equality match, auto-written on --apply
  - needs_review  no slug match, but window candidates exist (human triage)
  - unresolved    no slug match AND no window candidates (likely no site)
  - skipped       channel_site:<id> already has non-empty site_host

Idempotent: skips channels whose `channel_site:<id>` already has a non-empty
`site_host`. Safe to re-run after the forward-write PRs ship.

Inputs (env):
  MAC_REDIS_URL                   shared Redis (read for existing rows, write
                                  for new ones when --apply)
  CLOUDFLARE_TOKEN_MAKEACOMPANY_AI  scoped DNS:Read token for the zone
  CLOUDFLARE_ZONE_ID_MAKEACOMPANY_AI
  JOANNE_DUMP_PATH                JSONL with the 65 user channels Joanne
                                  emits via bot-handoff. Schema:
                                  {channel_id, channel_name,
                                   channel_created_at, user_id,
                                   first_seen_at}

Output (stdout):
  TSV report: channel_id, channel_name, status, site_host, reason

Run:
  python3 scripts/backfill-channel-site.py                 # dry-run
  python3 scripts/backfill-channel-site.py --apply         # write to Redis
  WINDOW_DAYS=21 python3 scripts/backfill-channel-site.py  # widen window
"""

import datetime as dt
import json
import os
import sys
import urllib.error
import urllib.request


def _env(name: str) -> str:
    v = os.environ.get(name, "")
    if not v:
        sys.stderr.write(f"missing env: {name}\n")
        sys.exit(2)
    return v


def _parse_ts(s: str) -> dt.datetime:
    s = s.rstrip("Z").split(".")[0]
    return dt.datetime.fromisoformat(s).replace(tzinfo=dt.timezone.utc)


def _fetch_dns_records(token: str, zone_id: str) -> dict[str, dt.datetime]:
    """Return {subdomain_without_zone: earliest created_on}. Older record wins
    on duplicates (a single subdomain occasionally has both an A and CNAME)."""
    req = urllib.request.Request(
        f"https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_records?per_page=500",
        headers={"Authorization": f"Bearer {token}"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read())
    if not data.get("success"):
        sys.stderr.write(f"cloudflare error: {data.get('errors')}\n")
        sys.exit(3)
    out: dict[str, dt.datetime] = {}
    for r in data["result"]:
        if r["type"] not in ("A", "CNAME"):
            continue
        name = r["name"]
        if not name.endswith(".makeacompany.ai") and name != "makeacompany.ai":
            continue
        sub = name[: -len(".makeacompany.ai")] if name != "makeacompany.ai" else "@"
        if not sub or sub in ("www", "_domainconnect", "@"):
            continue
        ts = _parse_ts(r["created_on"])
        if sub not in out or ts < out[sub]:
            out[sub] = ts
    return out


def main() -> int:
    apply = "--apply" in sys.argv
    window_days = int(os.environ.get("WINDOW_DAYS", "14"))
    dump_path = os.environ.get("JOANNE_DUMP_PATH", "/tmp/ttfv_joanne.jsonl")

    cf_token = _env("CLOUDFLARE_TOKEN_MAKEACOMPANY_AI")
    cf_zone = _env("CLOUDFLARE_ZONE_ID_MAKEACOMPANY_AI")
    redis_url = os.environ.get("MAC_REDIS_URL", "")

    if not os.path.exists(dump_path):
        sys.stderr.write(f"dump not found: {dump_path}\n")
        return 2

    rdb = None
    if redis_url:
        try:
            import redis  # type: ignore[import-not-found]
        except ImportError:
            sys.stderr.write("redis-py not installed; pip install redis\n")
            return 2
        rdb = redis.Redis.from_url(redis_url, socket_timeout=5)

    dns = _fetch_dns_records(cf_token, cf_zone)
    sys.stderr.write(f"DNS records loaded: {len(dns)} non-trivial subdomains\n")

    rows = []
    with open(dump_path) as f:
        for line in f:
            rows.append(json.loads(line))

    print(
        "channel_id\tchannel_name\tstatus\tsite_host\treason",
    )
    counts = {"resolved": 0, "needs_review": 0, "unresolved": 0, "skipped": 0}
    writes = []
    for r in rows:
        cid = r["channel_id"]
        cname = r["channel_name"]
        c_created = _parse_ts(r["channel_created_at"])
        window_end = c_created + dt.timedelta(days=window_days)

        if rdb is not None:
            try:
                existing = rdb.hget(f"channel_site:{cid}", "site_host")
                if existing and existing.decode() != "":
                    print(f"{cid}\t{cname}\tskipped\t{existing.decode()}\talready_resolved")
                    counts["skipped"] += 1
                    continue
            except Exception as e:  # noqa: BLE001
                sys.stderr.write(f"redis read failed for {cid}: {e}\n")

        # Tier 1: exact slug equality. Channel `endo` -> `endo.makeacompany.ai`
        # if the DNS record exists. Highest-confidence match; bypasses the
        # window heuristic entirely.
        slug_match = None
        for sub, ts in dns.items():
            if sub == cname:
                slug_match = (sub, ts, "slug=channel_name")
                break
            # Channel names sometimes use hyphens for subdomain dots:
            # `braces-for-feet` channel -> `bracesforfeet` subdomain.
            if sub == cname.replace("-", ""):
                slug_match = (sub, ts, "slug=channel_name (hyphens stripped)")
                break

        if slug_match is not None:
            sub, ts, reason = slug_match
            site_host = f"{sub}.makeacompany.ai"
            print(f"{cid}\t{cname}\tresolved\t{site_host}\t{reason}")
            counts["resolved"] += 1
            writes.append((cid, sub, site_host, ts, r.get("user_id", ""), cname))
            continue

        # Tier 2: time-window context. Logged for human triage only, NOT
        # auto-written. Empirically the window heuristic produces false
        # positives even at 1d (concurrent unrelated repos), so --apply only
        # writes Tier 1 (slug-equality) matches. The report surfaces window
        # candidates so a human can confirm a link by eye.
        candidates = [
            (sub, ts) for sub, ts in dns.items()
            if c_created <= ts <= window_end
        ]
        if len(candidates) == 0:
            print(f"{cid}\t{cname}\tunresolved\t\tno DNS records in {window_days}d window")
            counts["unresolved"] += 1
            continue
        cand_str = ",".join(sorted(s for s, _ in candidates))
        print(f"{cid}\t{cname}\tneeds_review\t\t{len(candidates)} window candidates: {cand_str}")
        counts["needs_review"] += 1

    sys.stderr.write(
        f"\nsummary: resolved={counts['resolved']} "
        f"needs_review={counts['needs_review']} "
        f"unresolved={counts['unresolved']} "
        f"skipped={counts['skipped']} "
        f"total={len(rows)}\n"
    )

    if not apply:
        sys.stderr.write("dry-run (no Redis writes). Re-run with --apply to commit.\n")
        return 0
    if rdb is None:
        sys.stderr.write("--apply set but MAC_REDIS_URL is unset; nothing to write.\n")
        return 2

    for cid, sub, site_host, ts, user_id, cname in writes:
        try:
            rdb.hset(
                f"channel_site:{cid}",
                mapping={
                    "site_host": site_host,
                    "repo_slug": sub,
                    "channel_name": cname,
                    "user_id": user_id,
                    "created_at": ts.strftime("%Y-%m-%dT%H:%M:%SZ"),
                    "created_by": "backfill",
                },
            )
        except Exception as e:  # noqa: BLE001
            sys.stderr.write(f"redis write failed for {cid}: {e}\n")
    sys.stderr.write(f"wrote {len(writes)} channel_site rows.\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
