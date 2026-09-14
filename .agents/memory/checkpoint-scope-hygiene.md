---
name: Checkpoint scope hygiene
description: Automatic workspace checkpoints can include uploaded instruction files alongside implementation changes
---

When a task requires a narrowly scoped commit, inspect the newest checkpoint commit before reporting its hash. Uploaded files may be present as untracked inputs at the start of work and can be swept into an automatic checkpoint unexpectedly.

**Why:** A P-12 checkpoint included the attached instruction text alongside the requested Vite config, so the local history had to be reconstructed before the scoped commit could be made correctly.

**How to apply:** Compare the final commit's changed paths with the requested scope and leave attached instruction files untracked unless the user explicitly asks to commit them.