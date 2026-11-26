import { decryptSecret } from '../utils/auth.ts';
import { parseSourceFile, type ParsedArtifact } from '../algorithms/codeParser.ts';

const GITHUB_API_BASE = 'https://api.github.com';
const SAFE_SEGMENT = /^[A-Za-z0-9_.-]+$/;

export function validateGitHubCoords(owner: string, repo: string, branch = 'main'): void {
  if (!SAFE_SEGMENT.test(owner) || !SAFE_SEGMENT.test(repo)) {
    throw new Error('Invalid GitHub repository owner or name format.');
  }
  if (!/^[A-Za-z0-9_.\-/]+$/.test(branch) || branch.includes('..')) {
    throw new Error('Invalid branch name.');
  }
}

async function githubFetch(apiPath: string, encryptedToken?: string): Promise<Response> {
  // SSRF protection: strict allowlisted host and validated relative API path
  const url = new URL(apiPath, GITHUB_API_BASE);
  if (url.origin !== GITHUB_API_BASE) {
    throw new Error('Disallowed external host.');
  }

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'RequirementRipple-Analyzer',
  };

  if (encryptedToken) {
    const token = decryptSecret(encryptedToken);
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    return await fetch(url.toString(), { headers, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export interface GitHubSyncOutput {
  defaultBranch: string;
  latestCommitSha: string;
  recentCommits: Array<{ sha: string; message: string; author: string; date: string }>;
  pullRequests: Array<{ number: number; title: string; state: string; author: string }>;
  parsedArtifacts: ParsedArtifact[];
  indexedFilesCount: number;
  warnings: string[];
}

export async function syncGitHubRepository(params: {
  owner: string;
  repo: string;
  branch: string;
  encryptedToken?: string;
}): Promise<GitHubSyncOutput> {
  validateGitHubCoords(params.owner, params.repo, params.branch);
  const warnings: string[] = [];

  const repoResp = await githubFetch(`/repos/${params.owner}/${params.repo}`, params.encryptedToken);
  if (!repoResp.ok) {
    const errBody = await repoResp.text();
    throw new Error(`GitHub API error (${repoResp.status}): ${errBody.slice(0, 180)}`);
  }
  const repoData = (await repoResp.json()) as { default_branch?: string };
  const targetBranch = params.branch || repoData.default_branch || 'main';

  const commitsResp = await githubFetch(
    `/repos/${params.owner}/${params.repo}/commits?sha=${encodeURIComponent(targetBranch)}&per_page=8`,
    params.encryptedToken
  );
  const commitsJson = commitsResp.ok
    ? ((await commitsResp.json()) as Array<{
        sha: string;
        commit: { message: string; author?: { name?: string; date?: string } };
      }>)
    : [];

  const recentCommits = commitsJson.map((c) => ({
    sha: c.sha.slice(0, 7),
    message: c.commit.message.split('\n')[0],
    author: c.commit.author?.name || 'Unknown',
    date: c.commit.author?.date || '',
  }));
  const latestCommitSha = commitsJson[0]?.sha || '';

  const prsResp = await githubFetch(
    `/repos/${params.owner}/${params.repo}/pulls?state=all&per_page=5`,
    params.encryptedToken
  );
  const prsJson = prsResp.ok
    ? ((await prsResp.json()) as Array<{
        number: number;
        title: string;
        state: string;
        user?: { login?: string };
      }>)
    : [];
  const pullRequests = prsJson.map((pr) => ({
    number: pr.number,
    title: pr.title,
    state: pr.state,
    author: pr.user?.login || 'Unknown',
  }));

  // Fetch repository file tree (capped to avoid excessive API calls)
  const treeResp = await githubFetch(
    `/repos/${params.owner}/${params.repo}/git/trees/${encodeURIComponent(targetBranch)}?recursive=1`,
    params.encryptedToken
  );
  const parsedArtifacts: ParsedArtifact[] = [];
  let indexedFilesCount = 0;

  if (treeResp.ok) {
    const treeData = (await treeResp.json()) as {
      tree?: Array<{ path: string; type: string; size?: number }>;
    };
    const codeFiles = (treeData.tree || [])
      .filter(
        (item) =>
          item.type === 'blob' &&
          (item.size || 0) <= 120_000 &&
          /\.(ts|tsx|js|jsx|py|sql)$/i.test(item.path) &&
          !item.path.includes('node_modules/') &&
          !item.path.includes('dist/')
      )
      .slice(0, 20);

    for (const file of codeFiles) {
      const contentResp = await githubFetch(
        `/repos/${params.owner}/${params.repo}/contents/${file.path
          .split('/')
          .map(encodeURIComponent)
          .join('/')}?ref=${encodeURIComponent(targetBranch)}`,
        params.encryptedToken
      );
      if (contentResp.ok) {
        const fileData = (await contentResp.json()) as { content?: string; encoding?: string };
        if (fileData.content && fileData.encoding === 'base64') {
          const decoded = Buffer.from(fileData.content, 'base64').toString('utf8');
          const artifacts = parseSourceFile(file.path, decoded);
          parsedArtifacts.push(...artifacts);
          indexedFilesCount += 1;
        }
      }
    }
    if ((treeData.tree || []).length > 20) {
      warnings.push('Indexed top 20 source files to stay within API rate limits.');
    }
  } else {
    warnings.push('Unable to fetch repository file tree; metadata and commits were synced.');
  }

  return {
    defaultBranch: repoData.default_branch || 'main',
    latestCommitSha,
    recentCommits,
    pullRequests,
    parsedArtifacts,
    indexedFilesCount,
    warnings,
  };
}
