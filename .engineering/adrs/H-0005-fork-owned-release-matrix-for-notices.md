---
Status: accepted
Date: 2026-09-02
---

# ADR H-0005: Fork-owned release matrix defines third-party notice coverage

## Context

Third-party notices must be stable across maintainer and CI hosts, but an Electron Builder target without an explicit architecture builds `process.arch`; it does not declare every architecture the fork distributes. macOS release scripts separately request a universal build, Linux is a development-only distribution surface, and Windows currently declares x64 on its target. Inferring one release matrix from those unequal mechanisms either depends on the host or invents architectures.

## Decision

`dsh-plugin-desktop/package.json` owns an explicit `dshReleaseMatrix` as the authoritative OS, CPU, and libc set for third-party notice generation. The license verifier consumes only that declaration and fails closed unless it is cross-fenced against Electron Builder in both directions: every declared OS has a platform target, every configured platform target is declared, and every target with an explicit architecture exactly matches the declaration. Packaging scripts and the adjacent manifest comment record why arch-less macOS and Linux targets have host-independent declared coverage without changing Electron Builder behavior.

## Consequences

Adding or removing a distributed OS, architecture, or libc requires updating the declaration and regenerating notices; explicit Electron Builder architecture changes fail until the declaration agrees. Arch-less targets never expand notice coverage implicitly, and `build` remains unchanged so `package:dir` and platform smoke behavior do not change.
