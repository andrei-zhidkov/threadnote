---
name: threadnote-context
description: Recall and read decisions from the configured Personal Codex Cloud Git memory shares.
---

<!-- BEGIN THREADNOTE USER INSTRUCTIONS -->

# Threadnote context in Personal Codex Cloud

Before non-trivial work run:

```sh
"$HOME/.local/bin/threadnote" cloud codex recall --cwd "$PWD" --query "Current task" --project PROJECT
```

Omit `--team` to recall all configured shares, or select one with `--team NAME`. Recall results are unread pointers.
Read relevant pointers with `cloud codex read --uri threadnote://...` before using them. For browsing, use
`cloud codex list --team NAME --recursive`. With multiple shares, list requires a team or an exact directory URI.
`--json` returns structured tool results, and diagnostics go to stderr. Commands fail with nonzero exits.

Reads are bounded to configured shares and the current identity's local handoffs. Larger memories return an outline;
use `read --mode outline` or `--offset-bytes 0`, then the returned next offset and source hash until complete.
Repository files and guidance are authoritative. Verify historical claims against the checkout. This memory profile
has no graph preparation, local inference, background daemon, or native hosted MCP registration.
If synchronization fails, report any cached-read warning and rerun `cloud codex start`; do not claim fresh remote evidence.
<!-- END THREADNOTE USER INSTRUCTIONS -->
