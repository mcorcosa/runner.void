# AI project setup guide

Use this guide to start a project with separate chats for ownership, management, implementation, and documentation. Give each chat a role, the project context it needs, and a clear reporting destination.

## Roles and decision authority

- **Owner** directs the project, sets priorities and constraints, and resolves decisions the project manager escalates.
- **Project manager (PM)** plans the work, makes decisions within the owner's direction, tracks progress and dependencies, and reports to the owner. The PM opens area manager chats on **Astra High** as needed.
- **Area managers** manage their assigned areas and report to both the PM and the owner. They assign implementation to separate chats on **Sol High** or **Sol Medium**. Use Sol High for complex or important work and Sol Medium for routine, bounded work. Escalate cross-area dependencies and decisions that exceed the assignment to the PM.
- **Implementers** make the assigned changes, verify the result, and report back to the assigning manager with the evidence and any remaining issues.
- **Librarian (Sol High)** verifies and maintains human-readable project documentation for agents and people. The PM and area managers send the Librarian findings and decisions that future chats need.

Managers own coordination and acceptance. Implementers own the assigned changes.

## Delegation and reporting

1. In the new chat, state the outcome, scope, relevant paths or links, constraints, how to verify completion, and where to report. Identify the workspace or branch when it matters. Assign clear ownership before starting parallel work that could touch the same files.
2. Report the result, evidence, and any blocker or decision needed. Include affected paths or links and say what was checked. Managers relay decisions, dependencies, and issues that need action to the people they report to.
3. Send durable findings and decisions to the Librarian with their source and scope. The Librarian checks findings against the relevant evidence and confirms decisions with the decision owner or their recorded approval. Update the relevant document, label unverified claims or open questions, and report the updated path and verification back to the sender.

## Reuse and improve this guide

Copy the guide into the next project's documentation and give new chats its path. Confirm role assignments and model choices for that project. Record local decisions such as tooling, build commands, and release procedures in project-specific documentation.

When a real handoff or documentation update exposes a gap, send the Librarian the example and what would have helped. Revise the reusable guide when the lesson applies across projects. Keep local decisions in their project and remove guidance that adds work without improving handoffs or verification.
