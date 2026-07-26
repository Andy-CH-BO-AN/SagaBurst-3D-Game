---
name: domain-modeling
description: Antigravity adapter for the domain-modeling skill. Read the canonical skill in ai_share/skills before acting.
---

# Antigravity Skill Adapter

Canonical skill source:

- `ai_share/skills/domain-modeling/SKILL.md`

This `.agents` file is only a thin adapter for repo-local skill discovery.

## Adapter rules

1. Read the canonical skill file in `ai_share/skills/...` before acting.
2. If this adapter and the canonical skill ever diverge, treat the
   `ai_share/skills/...` version as the source of truth.
