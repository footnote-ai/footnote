# GitHub Work Management

GitHub has several ways to describe work. Footnote uses each one for a specific
job instead of repeating the same information in several places.

| GitHub feature | What it means in Footnote                                                 |
| -------------- | ------------------------------------------------------------------------- |
| Assignee       | The person responsible for the next move                                  |
| Issue type     | Whether an issue is a `Feature`, `Bug`, or `Task`                         |
| Label          | An area, Footnote concern, contribution opportunity, or automation marker |
| Issue field    | Priority, effort, or a date for scheduled work                            |
| Project        | The shared view of active work and its current status                     |
| Milestone      | A finite outcome made up of several pieces of work                        |
| Relationship   | Parent/sub-issue structure or a hard dependency between issues            |

`AGENTS.md` remains the canonical instruction source. This page explains how to
apply those rules when creating or updating GitHub work.

## Assignees

Assign an issue when someone has taken responsibility for moving it forward.
Backlog issues can stay unassigned. Prefer one clear owner; add another only
when the work is genuinely shared.

The author of a pull request normally owns getting it merged. Use requested
reviewers for review responsibility rather than treating assignees as a
reviewer list.

## Issue Types

Use the organization types already available:

- `Feature`: a user-visible or project-level outcome
- `Bug`: behavior that is wrong or unexpectedly broken
- `Task`: bounded supporting work, including maintenance and documentation

Large features can be split into task sub-issues. Do not add `bug`, `feature`,
or `task` labels as a second type system.

## Labels

Labels are optional and non-exclusive. Keep them to information that does not
have a better native field.

Areas:

- `area: backend`
- `area: web`
- `area: discord`
- `area: runtime`
- `area: launcher`
- `area: shared`
- `area: deployment`
- `area: ci`
- `area: docs`

Footnote concerns:

- `provenance`
- `context`
- `privacy`
- `safety`
- `security`
- `accounts`
- `steerability`

Contribution and automation:

- `good first issue`
- `help wanted`
- `dependencies`
- `duplicate`

Do not add labels for priority, effort, dates, workflow status, issue type, or a
milestone. Close work as `not planned` through GitHub's issue state rather than
keeping separate `invalid` and `wontfix` labels.

## Issue Fields And The Project

Use the organization issue fields for:

- `Priority`: current importance, not urgency invented for an untouched backlog
- `Effort`: a rough size used for planning, not an estimate presented as fact
- `Start date`: when scheduled work is expected to begin
- `Target date`: when scheduled work is expected to finish

Leave a field empty when the answer is not known. In particular, do not add
placeholder dates to make a roadmap look complete.

Use the organization Project named [Footnote](https://github.com/orgs/footnote-ai/projects/5)
for active work. It is private because GitHub does not allow organization issue
fields in a public Project. That does not change the visibility of the public
issues linked from it.

The Project uses these statuses:

- `Inbox`: worth keeping, but not ready to start
- `Ready`: clear enough to pick up
- `In progress`: someone is working on it
- `In review`: the work is waiting for review
- `Blocked`: something else has to happen first
- `Done`: finished

Project views can group or filter by assignee, issue type, milestone, priority,
area, or concern without copying those values into new Project fields.

Create another project field only when it answers a planning question that the
native issue data cannot answer.

## Milestones And Relationships

A milestone needs a finish line. It should not stand for a permanent principle
such as transparency, safety, or steerability.

Use sub-issues when a feature needs smaller tracked tasks. Use `blocked by` and
`blocking` relationships only for real ordering constraints. A related issue
that can move independently should be linked in normal issue text instead.

Avoid copying sub-issues into a Markdown checklist. Avoid `blocked` labels when
GitHub can record the dependency directly.

For future work, put the milestone on the tracked issue. A pull request linked
to that issue does not need the same milestone. A standalone pull request may
carry a milestone when no issue owns the work. Older pull requests may remain
in milestones when they are being kept as project history.

## Pull Requests

Connect a pull request to the issue it completes with GitHub's closing or
linking relationship. The issue carries its type, priority, effort, dates, and
issue relationships. The pull request carries review state, checks, changed
files, and any useful area or concern labels.

Do not recreate issue metadata on a linked pull request merely to make the two
items look symmetrical.
