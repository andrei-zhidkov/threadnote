# Threadnote in Personal Codex Cloud

Use the installed `threadnote-context` and `threadnote-memory` skills for non-trivial work. At task startup run
`$HOME/.local/bin/threadnote cloud codex start`, then explicitly read
`$HOME/.agents/skills/threadnote-context/SKILL.md` and `$HOME/.agents/skills/threadnote-memory/SKILL.md`.
Use `threadnote cloud codex` CLI commands for memory. Read relevant `threadnote://` pointers before treating them as evidence.
Repository guidance and current source are authoritative. Durable memory is committed and pushed to a configured private
Git share; handoffs remain task-local. Never silently fall back to an unconfigured share or local durable storage.
Never store credentials, secrets, customer data or raw production logs. Confirm before durable sharing unless the user
has already authorized it. End meaningful work with a local `remember --kind handoff`.
