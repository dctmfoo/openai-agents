# 19) Backup/Restore + Incident Response Runbook (Local Family Deployment)

Status: ACTIVE (Pack 6)

## 1. Purpose

This runbook defines the operational flow for:
- creating local runtime backups,
- restoring from known backup snapshots,
- handling and auditing backup incidents.

## 2. Operational endpoints (admin API)

These routes are loopback-only and manager-gated by control-plane operations policy.

1. Create backup
- `POST /operations/backup/create?memberId=<parentMemberId>&backupId=<optional>`
- Optional filters:
  - `includePaths=config,memory,sessions,transcripts,logs`
  - `now=<ISO timestamp>`

2. Restore backup
- `POST /operations/backup/restore?memberId=<parentMemberId>&backupId=<required>`
- Optional filter:
  - `restorePaths=config,memory,...`

## 3. What gets backed up

Default backup paths:
- `config/`
- `memory/`
- `sessions/`
- `transcripts/`
- `logs/`

Each backup is stored under:
- `HALO_HOME/backups/<backupId>/snapshot/**`
- `HALO_HOME/backups/<backupId>/manifest.json`

Manifest contains:
- backup ID,
- creation time,
- included relative paths,
- file count and byte total.

## 4. Incident hooks and audit trails

1. Operational audit trail
- File: `HALO_HOME/logs/operations-audit.jsonl`
- Captures allowed/denied/failed actions for lane operations and backup operations.

2. Incident trail
- File: `HALO_HOME/logs/incidents.jsonl`
- Captures backup-specific failures (e.g., missing manifest, restore failures).

## 5. Failure handling playbook

### A) `backup_operation_failed` from API

1. Inspect response message from admin endpoint.
2. Check `logs/incidents.jsonl` for:
   - `backup_manifest_missing`
   - `backup_create_failed`
   - `backup_restore_failed`
3. Check `logs/operations-audit.jsonl` for actor + target details.
4. If restore failed mid-way:
   - create a fresh backup before retry if current state is still readable,
   - retry restore with narrowed `restorePaths` (e.g., `config` first).

### B) Missing backup manifest

Symptoms:
- restore endpoint returns 500 with `backup_operation_failed`.
- incident log contains `backup_manifest_missing`.

Actions:
1. Verify `HALO_HOME/backups/<backupId>/manifest.json` exists.
2. If backup directory exists without manifest, treat it as invalid backup.
3. Recreate backup from current runtime and re-run restore only after validation.

## 6. Validation checklist after restore

1. `GET /status` returns healthy payload.
2. Parent DM and child DM still resolve policy correctly.
3. Memory lane export endpoint works for manager parent.
4. New transcript writes continue succeeding.
5. No fresh critical incidents logged after restore.

## 7. Safety constraints

- Only parent managers (control-plane operations policy) may run backup/restore.
- Loopback-only requirement blocks remote invocation by default.
- Destructive lane operations use recoverable trash moves.
