# pi-clear-thinking

A [pi](https://pi.dev) package that adds `/clear-thinking`: remove thinking
blocks from the current session's stored history while leaving the thinking
level enabled.

## Why

Session history is append-only, and same-model replay sends signed thinking
blocks back to the provider on every request. When old reasoning is no longer
wanted (context size, noise, privacy), the only way to drop it is to rewrite
the session JSONL. `/clear-thinking` does that, then resumes the same session
so the TUI and future requests see the cleaned history. New turns keep
producing thinking.

## Install

```bash
pi install git:github.com/mahmoudhas/pi-clear-thinking@v1.0.0
```

Or try it without installing:

```bash
pi -e git:github.com/mahmoudhas/pi-clear-thinking@v1.0.0
```

## Usage

```
/clear-thinking
```

It waits for the agent to settle, rewrites every assistant message in the
session file without its `thinking` content blocks, atomically replaces the
file, and re-opens the session. It reports how many blocks and characters were
removed. The `thinking_level_change` entry, entry IDs, parent links, labels,
and all non-message entries are untouched, so the session tree and resume
behavior stay intact.

Caveats:

- Clears thinking from all branches in the session file, not just the active
  branch.
- The rewrite is destructive (no backup); the previous thinking text is gone.
- If the session is not persisted (for example `--no-session`), there is
  nothing to clear.
