---
layout: home

hero:
  name: Thalys
  text: Type-safe APIs on Bun
  tagline: Production-grade framework with Laravel DX and Porto architecture. Enterprise-ready, opinionated where it matters, flexible where it counts.
  actions:
    - theme: brand
      text: Get Started
      link: /getting-started/introduction
    - theme: alt
      text: Architecture
      link: /architecture/overview

features:
  - title: Porto Container Architecture
    details: Isolated domain containers with Actions, Tasks, Transformers, and Bridge contracts. No cross-container imports.
  - title: CLI-First DX
    details: Scaffold full CRUD containers, actions, tasks, events, and tests from the terminal with thalys:make:* commands.
  - title: Better Auth Integration
    details: Authentication wrapped behind AuthBridgePort. Bearer tokens, RBAC permissions, social auth — all swappable.
  - title: Swappable Infrastructure
    details: Cache, queue, rate limiting, and events all follow the same interface-first pattern. Redis in prod, in-memory in dev.
  - title: Type Safety End-to-End
    details: Drizzle schema → Task return type → Action → Transformer → HTTP response. No `as any` anywhere in the chain.
  - title: Production Readiness
    details: Health checks, Prometheus metrics, structured logging, error tracking hooks, and per-request profiling built in.
---
