# Nova Cortex

Multi-agent orchestration system — built step by step.

## Build steps

1. PTY Wrapper — start an AI agent in a terminal, inject messages, read output
2. Agent Identity — CLAUDE.md, IDENTITY.md, startup prompt
3. Telegram — messages from Telegram reach the agent
4. Cron Scheduler — agent runs tasks on a schedule
5. Daemon — supervises the agent, restarts on crash
6. Multi-agent — daemon manages multiple agents simultaneously
7. Orchestrator — one agent coordinates the others
