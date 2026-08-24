# Agent Note: Bounded chat ledger and history pages

Status: implemented

English | [中文](2026-08-23-bounded-chat-ledger-and-history-pages.zh.md)

## Problem

A long-running session — hundreds of tool steps inside one turn — made the conversation view slower the longer it ran and janky on every switch back to it. Three unbounded quantities compounded: `session.history` counted only messages, so one turn's entire tool-event mass rode a single page no matter how `maxMessages` was tuned; `ChatView` mounted one row per business node for the whole loaded window; and the bottom-follow signature included `order.length`, so every appended step forced a floor scroll write across that fully mounted list.

## Decision

Each layer now owns one bound, and they compose:

- Host pagination (`packages/host/apiproxy`) carries an independent tool-event budget of 80 `tool/call`/`tool/result` events per page alongside `maxMessages`. The backward scan keeps walking past a filled budget only until the next pair-safe boundary — tracked by results whose pairing call has not been scanned yet — so a cut never lands between a call and its result and no page ever splits an exchange.
- `ChatView` (`packages/client/ui-conversation`) renders the ordered flow as plain column chrome at or below 48 business nodes and as a virtual ledger above that: `@tanstack/react-virtual` with viewport-plus-overscan mounting, `measureElement` on every rendered row box, and explicit spacer stand-ins for skipped spans. Vertical rhythm moved from container gap to per-child trailing padding so each measured border-box owns its spacing; a zero-height marker above the rows feeds the ledger's content offset so hints and the older button stay outside it. While virtualized, the follow signature excludes row counts: pinned plain-tail appends keep the floor through the column resize observer and the virtualizer's end anchor, reader-scroll attribution is untouched, manual prepend anchoring remains the plain-path mechanism (the ledger hands prepend stability to the virtualizer's end anchor), and a saved position whose anchor row is outside the first estimated window restores through an index jump instead of a raw pixel write.
- The client runtime `Session` (`packages/client/runtime`) evicts its resident window's prefix once live events exceed 800, cutting at the earliest qualifying `turn/start` boundary (falling back to the earliest `step/start` when a single turn alone outgrows the budget, skipping when none qualifies) and reopening `hasMore` so loadOlder owns the dropped range. Conversation Definitions already tolerate windows that begin mid-story through their windowGap dependency; eviction is local bookkeeping and triggers no refetch.

## Alternatives considered

- **Byte-budgeted pages** — rejected: byte accounting couples the host to payload encodings and makes page composition nondeterministic across serializers; event-kind counting matches the established `maxMessages` semantics and is directly testable.
- **Always-on virtualization** — rejected: short conversations and the jsdom component suite gain nothing from a ledger, while the threshold keeps the plain path byte-for-byte compatible with the existing scroll contracts.
- **Arbitrary mid-turn prefix eviction** — rejected: dropping events inside a running turn degrades live node correlation for no retention benefit; lifecycle boundaries give the same bound with predictable reader-visible loss.

## Consequences

- Switching to a long session mounts bounded rows, and per-step render cost stops scaling with log length; the synthetic browser scroll lane pins this without DOM-cardinality assertions, so it qualified the virtualized implementation unchanged.
- Tool-heavy turns page below the message quota: reading deep history costs more loadOlder round-trips, and the tail page of a running turn carries only its newest exchanges.
- A resident oversized window forgets its oldest content in place until the reader pages it back; nothing refetches behind them, and reconnect resync rebuilds within budget again.
- Page weight still is not byte-bounded — one exchange with a huge tool result can dominate a page ([large-provenance scan note](../bug-fix/2026-08-04-large-history-pagination-call-stack.md)); the two concerns remain separate.
- Anchor ownership on the ledger diverges from the [sticky-composer scroll note](../bug-fix/2026-07-29-sticky-composer-conversation-scroll.md): its manual anchor governs the plain path only.
