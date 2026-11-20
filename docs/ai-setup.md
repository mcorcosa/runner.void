# AI project setup guide

Use this guide to start a project with separate chats for ownership, management, implementation, and documentation. Give each chat a role, the project context it needs, and a clear reporting destination.

## Model policy

Use Sol for all run.void project chats.

- **High** for the PM, area managers, the shared Project Librarian, and complex or important work.
- **Medium** for bounded work.
- **Low** for straightforward work that needs light reasoning.

## Roles and decision authority

- **Owner** directs the project, sets priorities and constraints, and resolves decisions the project manager escalates.
- **Project manager (PM)** plans the work, makes decisions within the owner's direction, tracks progress and dependencies, and reports to the owner. The PM opens area manager chats as needed and routes implementation through an area manager.
- **Area managers** plan and assign work in their areas, independently verify it for acceptance, and report to both the PM and the owner. Escalate cross-area dependencies and decisions that exceed the assignment to the PM.
- **Implementers** in separate Sol chats own changes to implementation code, tests (including new QA code), assets, configuration, and fixes. They verify the result and report back to the assigning manager with evidence and any remaining issues.
- **Librarian (Sol High)** verifies and maintains human-readable project documentation for agents and people.

The PM and area managers own coordination and independent acceptance. They may inspect project files read-only, run existing checks, and playtest. Only the assigned Sol implementer makes implementation changes. The same routing applies when the owner sends an implementation request directly to a manager. The team enforces this division through its handoff and acceptance procedure. Workspace permissions are a separate control.

## Delegation and reporting

1. For each distinct implementation assignment, the area manager creates a fresh, named, user-visible Sol project chat and selects effort using the [model policy](#model-policy). Revisions to the same assignment may stay with its named Sol owner.
2. Before any implementation changes, give the implementer a written handoff in the named chat. Record the actual implementer chat ID or link, exact model and reasoning effort, expected outcome, scope, owned paths, constraints, acceptance criteria and checks, and reporting destination. Identify the workspace or branch when it matters. Assign clear ownership before starting parallel work that could touch the same files. If the required Sol chat is missing or delegation is unavailable, hold implementation and escalate the blocker to the PM. The PM escalates unresolved blockers to the owner.
3. The implementer reports changed files, what they verified, the evidence, and any blocker or decision needed. The assigning manager independently verifies the result against the acceptance criteria, names the Sol chat that did the work, and reports the acceptance outcome and evidence to the PM and owner. Managers relay decisions, dependencies, and issues that need action. Send review findings that require implementation and fixes of any size back to Sol.
4. Route documentation assignments through the [shared Project Librarian](#shared-project-librarian).

## Shared Project Librarian

The PM and all area managers route every human-readable project documentation update through **run.void — Project Librarian**, chat ID `01a1f4f6-4d74-78e3-8fc2-3f684972c711` on host `local`, using `gpt-6.2-sol` with `high` reasoning effort. This includes onboarding, setup, decisions, and verification evidence.

The shared Librarian is the exception to the fresh-chat rule. Reuse this chat for every documentation assignment. If the chat cannot be reached, hold documentation edits and escalate to the PM. The former release documentation chat `01a1f4f7-5c14-7701-b9f5-f8403882fb23` is retained for historical reference.

Include the source, scope, and owned paths in the handoff. The Librarian handles one assignment at a time and coordinates path ownership before editing. The Librarian checks findings against the relevant evidence, confirms decisions with the decision owner or their recorded approval, updates the relevant documents, labels unverified claims or open questions, and reports the updated paths and verification to the sender.

## Reuse and improve this guide

Copy the guide into the next project's documentation and give new chats its path. Confirm role assignments and model choices for that project, and replace the Project Librarian chat details with that project's own. Record local decisions such as tooling, build commands, and release procedures in project-specific documentation.

When a real handoff or documentation update exposes a gap, send the Librarian the example and what would have helped. Revise the reusable guide when the lesson applies across projects. Keep local decisions in their project and remove guidance that adds work without improving handoffs or verification.
