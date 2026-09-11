---
name: GitHub connector publishing
description: Non-obvious constraints when publishing a clean source snapshot through the authenticated GitHub connector.
---

When direct Git push authentication is unavailable, use the GitHub connector and Git Data API. A newly created empty repository rejects blob creation with HTTP 409 until it has an initial commit, so seed it through the Contents API first.

**Why:** GitHub’s low-level blob endpoint reported “Git Repository is empty,” and concurrent uploads exceeded the Replit connector’s 10 requests-per-second throttle.

**How to apply:** Create one seed file/commit, then upload blobs sequentially or below 10 RPS with 429 backoff. Create a tree based on the seed tree, create a commit with the seed as parent, and update `refs/heads/main`.