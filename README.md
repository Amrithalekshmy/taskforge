# TaskForge

A desktop app (Electron) for tracking team work across a hierarchy:

**Chairperson → Heads (one per team) → Members**

| Role | Can see | Can assign to |
|---|---|---|
| Chairperson | Everyone's tasks, all teams, org stats | Anyone |
| Head | Their own + their team members' tasks | Themself and their team |
| Member | Their own tasks | Themself (personal tasks) |

## Features

- **Personal accounts.** Every person has a profile with their progress, time charts and GitHub activity.
- **Tasks** with priority, deadline, estimate, category, tags, checklist, comments, and a card or Kanban board view (drag to change status).
- **Progress bars** in three modes: manual slider, checklist-driven, or GitHub-driven.
- **Time tracking.** A start/stop timer (one running timer per person) or manual entries, with a per-person breakdown on each task.
- **GitHub integration.** Link a task to an issue, PR or milestone:
  - progress updates automatically: issue/PR task-list checkboxes, PR draft → open → approved, milestone closed/total issues
  - the task **completes itself** when the issue closes, the PR merges or the milestone finishes
  - each profile shows avatar, commits in the last 30 days, a 14-day commit chart, open PRs, recent repos and activity
- **Reminders.** A desktop notification 24h before each deadline (configurable), an overdue alert (also sent to the team head), and any number of custom reminders per task. The app keeps running in the system tray so reminders still fire after you close the window.
- **"Done?" suggestions.** When a task reaches 100% but isn't closed, the app suggests marking it done.
- **Event follow-ups.** When an event-like task completes, the app asks whether it was for an event, then suggests next steps (sponsor thank-yous and deliverable reports, payments, certificates, recap posts, feedback forms…). These become tasks with deadlines and reminders. With an Anthropic API key, Claude researches the suggestions with live web search. Without a key, a built-in checklist is used.

## Run it

```bash
npm install
npm start            # or: npm run dev  (opens DevTools)
```

If `npm install` skips dev dependencies on your machine, run `npm install --include=dev`.

On first launch you create the workspace and become the **Chairperson**. Then go to **Organisation** to create teams, appoint heads and add people.

### GitHub

Each person goes to **My profile → Connect GitHub** and pastes a
[fine-grained personal access token](https://github.com/settings/tokens?type=beta) with read access to
*Contents, Issues, Pull requests, Metadata*. Tokens are encrypted with the OS keychain (Electron `safeStorage`).
Heads and the chairperson can also attach a public GitHub username to someone who has no token.

### AI follow-ups (optional)

The chairperson adds an Anthropic API key in **Settings**. Alternatively, set `ANTHROPIC_API_KEY` before launching.

## Data

Everything is stored in one JSON file in the app's user-data folder
(`~/.config/TaskForge/taskforge-db.json` on Linux). Set `TASKFORGE_DATA_DIR` to use another folder.

> Note: this version stores data locally, so everyone signs in on the same computer.
> To use it across many devices, see the suggested "cloud sync" improvement.
