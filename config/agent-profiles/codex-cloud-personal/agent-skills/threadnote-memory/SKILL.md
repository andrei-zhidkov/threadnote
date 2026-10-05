---
name: threadnote-memory
description: Store reusable decisions in a selected Codex Cloud Git share and task-local handoffs.
---

<!-- BEGIN THREADNOTE USER INSTRUCTIONS -->

# Threadnote memory in Personal Codex Cloud

Preserve reusable decisions only when durable sharing is authorized. A durable write commits and pushes directly to
one configured private Git share. With multiple shares, pass `--team NAME`; do not guess a share. Use stable project
and topic identities. Update an existing record with `--replace-uri URI`; it retains its established share.
References and typed relations must remain inside that same share, including aliases and relocated pointers.

```sh
"$HOME/.local/bin/threadnote" cloud codex remember --kind durable --team NAME \
  --project PROJECT --topic TOPIC --text "Reviewed decision and its reason."
```

Never store secrets, credentials, customer data, or raw production logs. The existing sensitive-content and conflict
checks apply. Report failed writes or pushes; durable writes never silently fall back to local storage. Review existing
Git conflicts with `threadnote share conflicts --team NAME` before retrying.

Before ending meaningful work, write a private task-local handoff:

```sh
"$HOME/.local/bin/threadnote" cloud codex remember --kind handoff --project PROJECT \
  --topic TOPIC --text "Task; decisions/invariants; verification; blockers/risks; next step."
```

Handoffs remain in this task's home and are not pushed or carried into fresh tasks. Read this identity's local handoffs
with `cloud codex read --uri URI`; use `cloud codex list --uri threadnote://user/USER/memories/handoffs --recursive`.
<!-- END THREADNOTE USER INSTRUCTIONS -->
