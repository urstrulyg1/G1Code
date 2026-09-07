# Data Model

SQLite is the planned durable store, accessed through repositories rather than raw UI calls. Core tables are `projects`, `sessions`, `messages`, `plans`, `tool_executions`, `model_usage`, `file_index`, and `preferences`. Secrets are references to OS credential storage, never values in these tables.

Session records are append-oriented so a crashed process can recover the last known agent state and activity timeline. Index rows are replaceable by workspace and content hash.
