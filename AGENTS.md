# Project chat startup

At the start of every project chat, read [docs/ai-setup.md](docs/ai-setup.md) and follow the procedure for your role.

- The project manager (PM) and area managers use read-only project access for planning, dispatch, review, and acceptance. The PM routes implementation assignments to an area manager.
- Before implementation edits begin, the area manager creates a separate named Sol project chat for each distinct implementation assignment and dispatches the work there. The area manager selects Sol High for complex work and Sol Medium for bounded work, reuses the chat only for revisions to its original assignment, and pauses implementation and escalates to the PM if delegation fails.
- The assigned Sol implementer edits the owned paths. This applies to all implementation, including code, fixes of any size, tests, code-bearing QA harnesses, assets, and configuration.
- The area manager records the actual implementer chat ID, model and reasoning effort, and owned paths in the handoff. In the acceptance report, the area manager attributes changes to their author and includes those details, the result, and evidence from independent verification.
- The PM and all area managers reuse the same chat for every human-readable documentation assignment. Follow the routing and escalation procedure for the [shared Project Librarian](docs/ai-setup.md#shared-project-librarian).
