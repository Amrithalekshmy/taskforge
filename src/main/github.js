// Thin GitHub REST client + task-link sync logic.
const API = 'https://api.github.com';

class GitHubError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function gh(path, token) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'TaskForge-Desktop',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, { headers });
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).message || msg; } catch {}
    if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') {
      msg = 'GitHub rate limit reached – connect a token in your profile to raise it.';
    }
    throw new GitHubError(res.status, msg);
  }
  return res.json();
}

function parseRepo(input) {
  if (!input) return null;
  const m = String(input).trim()
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/\.git$/, '')
    .match(/^([\w.-]+)\/([\w.-]+)/);
  return m ? `${m[1]}/${m[2]}` : null;
}

// Counts GitHub task-list items ("- [ ]" / "- [x]") in an issue/PR body.
function checklist(body) {
  const items = [...String(body || '').matchAll(/^\s*[-*]\s+\[( |x|X)\]/gm)];
  const done = items.filter((m) => m[1].toLowerCase() === 'x').length;
  return { total: items.length, done };
}

async function viewer(token) {
  return gh('/user', token);
}

async function profileBundle(login, token) {
  const [user, repos, events, prs] = await Promise.all([
    gh(`/users/${login}`, token),
    gh(`/users/${login}/repos?sort=pushed&per_page=8`, token),
    gh(`/users/${login}/events?per_page=100`, token).catch(() => []),
    gh(`/search/issues?q=${encodeURIComponent(`author:${login} type:pr state:open`)}&per_page=10`, token)
      .catch(() => ({ items: [] })),
  ]);

  // Commits per day for the last 14 days, from public PushEvents.
  const days = {};
  const now = Date.now();
  for (let i = 13; i >= 0; i--) {
    days[new Date(now - i * 86400000).toISOString().slice(0, 10)] = 0;
  }
  let commits30 = 0;
  const recent = [];
  for (const ev of events) {
    const day = ev.created_at.slice(0, 10);
    if (ev.type === 'PushEvent') {
      const n = ev.payload?.size ?? ev.payload?.commits?.length ?? 1;
      if (now - Date.parse(ev.created_at) < 30 * 86400000) commits30 += n;
      if (day in days) days[day] += n;
    }
    if (recent.length < 12) {
      recent.push({ type: ev.type, repo: ev.repo?.name, at: ev.created_at, ...describeEvent(ev) });
    }
  }

  return {
    fetchedAt: new Date().toISOString(),
    user: {
      login: user.login, name: user.name, avatar: user.avatar_url, url: user.html_url,
      bio: user.bio, followers: user.followers, following: user.following,
      publicRepos: user.public_repos, company: user.company, location: user.location,
    },
    repos: repos.map((r) => ({
      name: r.full_name, url: r.html_url, description: r.description, language: r.language,
      stars: r.stargazers_count, forks: r.forks_count, pushedAt: r.pushed_at, openIssues: r.open_issues_count,
    })),
    openPRs: (prs.items || []).map((p) => ({
      title: p.title, url: p.html_url, repo: p.repository_url.split('/repos/')[1], number: p.number,
    })),
    commits30,
    commitsByDay: Object.entries(days).map(([day, count]) => ({ day, count })),
    recent,
  };
}

function describeEvent(ev) {
  const p = ev.payload || {};
  switch (ev.type) {
    case 'PushEvent': return { text: `Pushed ${p.size ?? p.commits?.length ?? ''} commit(s) to ${String(p.ref || '').replace('refs/heads/', '')}` };
    case 'PullRequestEvent': return { text: `${p.action} PR #${p.number}: ${p.pull_request?.title || ''}` };
    case 'IssuesEvent': return { text: `${p.action} issue #${p.issue?.number}: ${p.issue?.title || ''}` };
    case 'CreateEvent': return { text: `Created ${p.ref_type} ${p.ref || ''}` };
    case 'IssueCommentEvent': return { text: `Commented on #${p.issue?.number}` };
    case 'PullRequestReviewEvent': return { text: `Reviewed PR #${p.pull_request?.number}` };
    case 'WatchEvent': return { text: 'Starred repo' };
    default: return { text: ev.type.replace(/Event$/, '') };
  }
}

async function repoItems(repo, token) {
  const r = parseRepo(repo);
  if (!r) throw new GitHubError(400, 'Use the form owner/repo');
  const [issues, milestones] = await Promise.all([
    gh(`/repos/${r}/issues?state=open&per_page=50`, token),
    gh(`/repos/${r}/milestones?state=open&per_page=30`, token).catch(() => []),
  ]);
  return {
    repo: r,
    issues: issues.filter((i) => !i.pull_request).map((i) => ({ number: i.number, title: i.title })),
    pulls: issues.filter((i) => i.pull_request).map((i) => ({ number: i.number, title: i.title })),
    milestones: milestones.map((m) => ({ number: m.number, title: m.title })),
  };
}

async function myRepos(token) {
  const repos = await gh('/user/repos?sort=pushed&per_page=100', token);
  return repos.map((r) => r.full_name);
}

/**
 * Fetches the linked GitHub item and derives progress.
 * Returns { progress|null, done, state, info }. progress=null means "GitHub
 * gives no signal, keep the user's manual value".
 */
async function syncLink(link, token) {
  const repo = parseRepo(link.repo);
  if (!repo) throw new GitHubError(400, 'Invalid repo');
  const n = Number(link.number);

  if (link.type === 'issue') {
    const i = await gh(`/repos/${repo}/issues/${n}`, token);
    const cl = checklist(i.body);
    const closedDone = i.state === 'closed' && i.state_reason !== 'not_planned';
    let progress = null;
    if (closedDone) progress = 100;
    else if (cl.total) progress = Math.round((cl.done / cl.total) * 100);
    return {
      progress, done: closedDone, state: i.state_reason === 'not_planned' ? 'closed (not planned)' : i.state,
      info: {
        title: i.title, url: i.html_url, comments: i.comments, labels: i.labels.map((l) => l.name),
        assignees: i.assignees.map((a) => a.login), checklist: cl, updatedAt: i.updated_at, closedAt: i.closed_at,
      },
    };
  }

  if (link.type === 'pr') {
    const [p, reviews] = await Promise.all([
      gh(`/repos/${repo}/pulls/${n}`, token),
      gh(`/repos/${repo}/pulls/${n}/reviews?per_page=50`, token).catch(() => []),
    ]);
    const cl = checklist(p.body);
    const approved = reviews.some((r) => r.state === 'APPROVED');
    let progress;
    let state = p.state;
    if (p.merged) { progress = 100; state = 'merged'; }
    else if (cl.total) progress = Math.round((cl.done / cl.total) * 90);
    else if (p.state === 'closed') progress = null;
    else if (approved) progress = 85;
    else if (p.draft) progress = 30;
    else progress = 60;
    if (p.draft && !p.merged) state = 'draft';
    return {
      progress, done: !!p.merged, state,
      info: {
        title: p.title, url: p.html_url, commits: p.commits, additions: p.additions, deletions: p.deletions,
        changedFiles: p.changed_files, approved, reviewers: [...new Set(reviews.map((r) => r.user?.login))],
        branch: p.head?.ref, checklist: cl, updatedAt: p.updated_at, mergedAt: p.merged_at,
      },
    };
  }

  if (link.type === 'milestone') {
    const m = await gh(`/repos/${repo}/milestones/${n}`, token);
    const total = m.open_issues + m.closed_issues;
    const progress = total ? Math.round((m.closed_issues / total) * 100) : null;
    const done = m.state === 'closed' || (total > 0 && m.open_issues === 0);
    return {
      progress: done ? 100 : progress, done, state: m.state,
      info: {
        title: m.title, url: m.html_url, openIssues: m.open_issues, closedIssues: m.closed_issues,
        dueOn: m.due_on, updatedAt: m.updated_at,
      },
    };
  }

  throw new GitHubError(400, `Unknown link type ${link.type}`);
}

module.exports = { viewer, profileBundle, repoItems, myRepos, syncLink, parseRepo, GitHubError };
