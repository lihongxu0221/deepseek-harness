# Agent Note: Additive edits against master

Status: implemented

English | [中文](2026-08-23-additive-edits-against-master.zh.md)

## Problem

Agents working on feature branches rename or delete files and identifiers that already exist on the default branch. Those edits break callers that landed on `master`, enlarge merge conflicts, and invert the repository's extension-point model: new behavior is supposed to appear as added methods or plugins, not as replacements of existing names.

A literal ban on editing any file that exists on `master` also fails, because adding a method requires writing into that file.

## Decision

The default branch is `master`. A file that exists there must keep its path. Methods, parameter names, and variable names that file already declares must keep those names and must not be removed. Adding methods is allowed. Adding new files is allowed.

An existing method's body, signature, parameters, and local variable names stay as they are on `master`. New behavior goes in a new method, a new file, or an existing extension point that does not require editing the frozen method.

These edits remain allowed against a `master` path:

- adding methods, types, constants, imports, and JSDoc that the new methods need
- regenerating an owned artifact at the same path
- updating tests, snapshots, and documentation that describe an allowed additive change
- following the [vendoring policy](../../../../AGENTS.md#vendoring-policy) for `vendor/`
- a change the current user request explicitly authorizes, including edits to this standing order

Root [AGENTS.md](../../../../AGENTS.md#additive-edits-against-master) carries the standing order. The [pre-release stance](../../../../AGENTS.md#pre-release-stance-foundation-over-blast-radius) still rejects old on-disk and wire formats. It does not authorize renaming or deleting `master` source files or identifiers.

## Alternatives considered

**Forbid every edit to a file that exists on `master`.** Adding a method requires modifying the file. The rule would make the allowed exception impossible.

**Limit the freeze to exported public APIs.** The standing order names methods, parameter names, and variable names, not only exports. A public-only freeze would still allow silent renames of internal identifiers that callers and tests already depend on.

**Treat coordinated foundation renames as an ordinary exception.** That exception is the class of source churn this rule exists to stop. A rename or deletion of a `master` file or identifier proceeds only when the current user request explicitly authorizes it.

**Allow existing method bodies to change whenever names stay.** Body edits still change behavior at existing call sites and still collide with parallel work on the same method. New methods keep those call sites stable.

## Consequences

Feature work prefers new methods and new files. Bug fixes that must edit a frozen method need an explicit user request. Dead-API deletions such as [prune dead public API](../../proposed/simplification/2026-07-04-prune-dead-core-spine-api.md) stay proposed until such a request authorizes them. Merge conflicts concentrate on added regions instead of renamed identifiers.
