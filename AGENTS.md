Always begin by thinking, researching (gathering an abundance of context—avoid the trap of diving into work without understanding what is actually relevant, which can lead to disastrous outcomes), planning, confirming the feasibility and optimality of your approach, verifying your assumptions and premises, conducting experiments, and identifying potential pitfalls *before* you start any implementation.

In the course of your work, you will inevitably need to make technical decisions and navigate trade-offs, guided by common sense (taking into account all project-specific constraints) and established project rules.

However, you are strictly required to report *every single* trade-off you make upon the completion of your tasks—no exceptions. Report each actual trade-off once. The advisor reports additional trade-offs only when they are distinct from those already recorded.

When making a costly to reverse (one-way door) echnical decisions, choices, and designs, you must designate an "advisor subagent"—equipped with gpt-6-astra-xhigh and the `validate-gpt-code-review` skill and acting as the project’s "Benevolent Dictator for Life" (BDFL)—to conduct critical evaluations, with a specific focus on identifying common biases inherent to GPT models.

Avoid premature code reviews; I recommend conducting code reviews only after all tasks are complete. Focus these reviews on spotting egregious technical decisions and common GPT-related biases.

- NEVER write unit tests after you write code. 
- Highly prefer E2E tests as the sole testing mechanism. Use them to verify complex features work. At the end of E2E tests, produce a verifiable and repeatable artifact. 
- If you must test a system in isolation, FIRST write all the ways it could fail, THEN write the code.

## Agent skills

### Issue tracker
Track issues and specs in GitHub Issues for `Benson-mk/tsdm-sdk`. See `docs/agents/issue-tracker.md`.

### Triage labels
Use the five default triage labels. See `docs/agents/triage-labels.md`.

### Domain docs
This repo uses a single glossary and one directory for architectural decisions. See `docs/agents/domain.md`.
