# AI project setup guide

Use this guide to start a project with separate chats for ownership, management, implementation, and documentation. Give each chat a role, the project context it needs, and a clear reporting destination.

## Roles and decision authority

- **Owner** directs the project, sets priorities and constraints, and resolves decisions the project manager escalates.
- **Project manager (PM)** plans the work, makes decisions within the owner's direction, tracks progress and dependencies, and reports to the owner. The PM opens area manager chats on **Astra High** as needed and routes implementation through an area manager.
- **Area managers (Astra High)** plan and assign work in their areas, independently verify it for acceptance, and report to both the PM and the owner. Escalate cross-area dependencies and decisions that exceed the assignment to the PM.
- **Implementers** in separate Sol chats own changes to implementation code, tests (including new QA code), assets, configuration, and fixes. They verify the result and report back to the assigning manager with evidence and any remaining issues.
- **Librarian (Sol High)** verifies and maintains human-readable project documentation for agents and people. The PM and area managers send the Librarian findings and decisions that future chats need.

The PM and area managers own coordination and independent acceptance. They may inspect project files read-only, run existing checks, and playtest. Only the assigned Sol implementer makes implementation changes. The same routing applies when the owner sends an implementation request directly to a manager. The team enforces this division through its handoff and acceptance procedure. Workspace permissions are a separate control.

## Delegation and reporting

1. For each distinct implementation assignment, the area manager creates a fresh, named, user-visible project chat. Use **Sol High** for complex or important work and **Sol Medium** for bounded work. Revisions to the same assignment may stay with its named Sol owner.
2. Before any implementation changes, give the implementer a written handoff in the named chat. Record the actual implementer chat ID or link, exact model and reasoning effort, expected outcome, scope, owned paths, constraints, acceptance criteria and checks, and reporting destination. Identify the workspace or branch when it matters. Assign clear ownership before starting parallel work that could touch the same files. If the required Sol chat is missing or delegation is unavailable, hold implementation and escalate the blocker to the PM. The PM escalates unresolved blockers to the owner.
3. The implementer reports changed files, what they verified, the evidence, and any blocker or decision needed. The assigning manager independently verifies the result against the acceptance criteria, names the Sol chat that did the work, and reports the acceptance outcome and evidence to the PM and owner. Managers relay decisions, dependencies, and issues that need action. Send review findings that require implementation and fixes of any size back to Sol.
4. Send durable findings and decisions to the Librarian with their source and scope. The Librarian checks findings against the relevant evidence and confirms decisions with the decision owner or their recorded approval. Update the relevant document, label unverified claims or open questions, and report the updated path and verification back to the sender.

## Reuse and improve this guide

Copy the guide into the next project's documentation and give new chats its path. Confirm role assignments and model choices for that project. Record local decisions such as tooling, build commands, and release procedures in project-specific documentation.

When a real handoff or documentation update exposes a gap, send the Librarian the example and what would have helped. Revise the reusable guide when the lesson applies across projects. Keep local decisions in their project and remove guidance that adds work without improving handoffs or verification.
