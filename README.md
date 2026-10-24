# TaskForge

A desktop app (Electron) for tracking team work across a hierarchy:

**Chairperson → Heads (one per team) → Members**

| Role | Can see | Can assign to |
|---|---|---|
| Chairperson | Everyone's tasks, all teams, org stats | Anyone |
| Head | Their own + their team members' tasks | Themself and their team |
| Member | Their own tasks | Themself (personal tasks) |

## Accounts & secret role codes

- **First launch:** name the organisation and choose two secret codes: a **Chairperson code** and a **Head code**. No account is created at this step, so whoever installs the app doesn't become chairperson.
- **Log in / Sign up:** anyone can sign up as a **Member** and pick a team. Signing up as a **Head** (claim a team without a head, or create a new one) or as **Chairperson** requires that role's code.
- Codes are stored as one-way scrypt hashes, never in plain text. After 5 wrong attempts, sign-up for that role is locked for a minute.
- The chairperson can change both codes in **Settings → Sign-up codes**. Changing the code after sharing it stops anyone who has the old code from using it.
- Chairpersons and heads can still add people directly from **Organisation / Team → Add person**.

## Features

- **The chairperson has tasks too.** "My tasks" shows their own work. Their dashboard also has an **All deadlines** panel covering the whole organisation (heads see their team's deadlines), grouped into overdue, today, next 7 days and later.
- **Calendar** has Month and All-deadlines views, with team and person filters and a "My tasks only" switch.
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

On first launch, set up the workspace codes. Then share the Chairperson code with your chairperson and the Head code with team heads, so everyone can sign up for their own account.

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
