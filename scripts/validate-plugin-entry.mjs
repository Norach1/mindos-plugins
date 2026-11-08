// Validates a pull request that adds a plugin to community-plugins.json —
// the MindOs counterpart of the check obsidianmd/obsidian-releases ran on
// plugin submissions (validate-plugin-entry.yml, retired in May 2026 when
// Obsidian moved submissions to its own website).
//
// SECURITY: this runs from a `pull_request_target` workflow, which has a
// token for the registry repository. It must never execute anything from
// the pull request: the workflow runs THIS file from the base branch, and
// the pull request's files are only read as data (JSON.parse). No
// dependencies, no eval, no shelling out.
//
// Usage (CI): node scripts/validate-plugin-entry.mjs
//   BASE_DIR       checkout of the base branch (trusted)
//   PR_DIR         checkout of the pull request head (data only)
//   CHANGED_FILES  newline-separated paths changed by the pull request
//   PR_AUTHOR      GitHub login that opened the pull request
//   PR_BODY_FILE   file holding the pull request description
//   GITHUB_TOKEN   token for GitHub's REST API (read-only use)
//   REPORT_FILE    where to write the Markdown report (optional)
// Exit code 1 when there are errors.
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export const PLUGINS_FILE = 'community-plugins.json'
export const REMOVED_FILE = 'community-plugins-removed.json'
const ENTRY_KEYS = ['id', 'name', 'author', 'description', 'repo']
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const RELEASE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const REPO_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}\/[A-Za-z0-9._-]{1,100}$/
const ASSET_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.(js|mjs|cjs)$/
const MANIFEST_KEYS = new Set(['id', 'name', 'version', 'apiVersion', 'minAppVersion', 'description', 'author', 'authorUrl', 'fundingUrl', 'helpUrl', 'platforms', 'main', 'renderer'])

/** Every line of the pull request template the submitter must keep (checked as text). */
export const TEMPLATE_STRINGS = [
  'My repository is public and its README.md describes what the plugin does and how to use it.',
  'My repository has a LICENSE file.',
  'The `id`, `name` and `description` in my entry match manifest.json on my default branch.',
  'A published GitHub release is tagged exactly with the version in manifest.json (no "v" prefix) and has manifest.json and every file the manifest names attached as individual files.',
  'I have tested the plugin in MindOs.',
  'I have read the plugin guidelines in the registry README.'
]

/**
 * @typedef {{
 *   getRepo(repo: string): Promise<{ private: boolean, archived: boolean, hasIssues: boolean } | null>,
 *   isOrgMember(org: string, user: string): Promise<boolean>,
 *   getHeadFile(repo: string, path: string): Promise<string | null>,
 *   getRelease(repo: string, tag: string): Promise<{ draft: boolean, assets: string[] } | null>,
 *   getReleaseAsset(repo: string, tag: string, name: string): Promise<string | null>,
 *   hasLicense(repo: string): Promise<boolean>
 * }} GitHubReader
 */

function parseList(text, file, errors) {
  try {
    const value = JSON.parse(text)
    if (!Array.isArray(value)) throw new Error('not a list')
    return value
  } catch (error) {
    errors.push(`\`${file}\` must be valid JSON containing a list (${error.message}).`)
    return null
  }
}

const lower = (value) => (typeof value === 'string' ? value.toLowerCase() : '')

/**
 * Checks one submission. Pure apart from `github` (injected, so tests need
 * no network). Returns { errors, warnings, entry, skipped }.
 * @param {{ basePluginsText: string, prPluginsText: string, removedText?: string, changedFiles: string[], prAuthor: string, prBody: string, github: GitHubReader }} input
 */
export async function validateSubmission(input) {
  const errors = []
  const warnings = []
  const result = { errors, warnings, entry: null, skipped: false }

  const otherFiles = input.changedFiles.filter((file) => file !== PLUGINS_FILE)
  if (otherFiles.length > 0) errors.push(`Only \`${PLUGINS_FILE}\` may be changed in a submission (also changed: ${otherFiles.map((f) => `\`${f}\``).join(', ')}).`)

  const base = parseList(input.basePluginsText, PLUGINS_FILE, errors) ?? []
  const pr = parseList(input.prPluginsText, PLUGINS_FILE, errors)
  if (!pr) return result
  const removed = input.removedText ? (parseList(input.removedText, REMOVED_FILE, errors) ?? []) : []

  const baseById = new Map(base.map((entry) => [entry?.id, JSON.stringify(entry)]))
  const added = pr.filter((entry) => !baseById.has(entry?.id))
  const prIds = new Set(pr.map((entry) => entry?.id))
  const changedExisting = pr.filter((entry) => baseById.has(entry?.id) && baseById.get(entry.id) !== JSON.stringify(entry))
  const dropped = base.filter((entry) => !prIds.has(entry?.id))

  if (added.length === 0) {
    // Edits and removals are maintenance, not submissions: a maintainer reviews them.
    result.skipped = true
    warnings.push('This pull request adds no plugin, so it was not validated automatically. A maintainer will review it.')
    return result
  }
  if (added.length > 1) errors.push('Add exactly one plugin per pull request.')
  if (changedExisting.length > 0 || dropped.length > 0) errors.push('Don’t change or remove other entries in a submission.')
  const entry = added[0]
  result.entry = entry
  if (pr[pr.length - 1] !== entry) errors.push('Add your entry at the end of the list.')

  if (!input.prBody || !TEMPLATE_STRINGS.every((line) => input.prBody.includes(line))) {
    errors.push('Use the plugin pull request template and keep every checklist line.')
  }

  // --- The entry itself ------------------------------------------------------------
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    errors.push('The entry must be a JSON object.')
    return result
  }
  for (const key of ENTRY_KEYS) if (typeof entry[key] !== 'string' || entry[key].trim() === '') errors.push(`The entry needs a text \`${key}\`.`)
  for (const key of Object.keys(entry)) if (!ENTRY_KEYS.includes(key)) errors.push(`The entry has an unknown property \`${key}\`. Only ${ENTRY_KEYS.map((k) => `\`${k}\``).join(', ')} are allowed.`)
  if (errors.some((message) => message.startsWith('The entry'))) return result

  const { id, name, author, description, repo } = entry
  if (!ID_PATTERN.test(id) || id.length < 2 || id.length > 64) errors.push('The `id` must be 2–64 lowercase letters, digits and single hyphens.')
  if (lower(id).includes('mindos')) errors.push('Don’t use “mindos” in the `id`.')
  if (lower(id).endsWith('plugin')) errors.push('Don’t end the `id` with “plugin”.')
  if (lower(name).includes('mindos')) errors.push('Don’t use “MindOs” in the `name`.')
  if (lower(name).endsWith('plugin')) errors.push('Don’t end the `name` with “Plugin”.')
  if (name.length > 100) errors.push('The `name` is too long (100 characters at most).')
  if (lower(description).includes('mindos')) errors.push('Don’t mention “MindOs” in the `description`.')
  if (!/[.?!)]$/.test(description)) errors.push('End the `description` with `.`, `?`, `!` or `)`.')
  if (description.length > 250) errors.push('Keep the `description` under 250 characters.')
  if (/\bthis (is a )?plugin\b/i.test(description)) warnings.push('Avoid phrases like “This plugin…” in the description; say what it does.')
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(author)) warnings.push('We discourage putting an email address in `author`.')
  if (!REPO_PATTERN.test(repo) || repo.split('/')[1] === '.' || repo.split('/')[1] === '..') errors.push('`repo` must be a GitHub repository written as `owner/name`.')

  // --- Uniqueness ---------------------------------------------------------------
  if (pr.filter((other) => other?.id === id).length > 1) errors.push(`A plugin with the id \`${id}\` already exists.`)
  if (pr.filter((other) => lower(other?.name) === lower(name)).length > 1) errors.push(`A plugin named \`${name}\` already exists.`)
  if (pr.filter((other) => lower(other?.repo) === lower(repo)).length > 1) errors.push(`An entry already points to \`${repo}\`.`)
  if (removed.some((other) => other?.id === id)) errors.push(`The id \`${id}\` belonged to a removed plugin and can’t be reused (installed copies would be confused with yours).`)
  if (removed.some((other) => lower(other?.name) === lower(name))) warnings.push(`A removed plugin was called \`${name}\`; consider another name.`)
  if (errors.length > 0) return result

  // --- Ownership ------------------------------------------------------------------
  const [owner] = repo.split('/')
  if (lower(owner) !== lower(input.prAuthor) && !(await input.github.isOrgMember(owner, input.prAuthor))) {
    errors.push(`Submit from the account that owns \`${repo}\` (or as a PUBLIC member of the \`${owner}\` organization).`)
  }

  // --- The repository ------------------------------------------------------------
  const info = await input.github.getRepo(repo)
  if (!info) {
    errors.push(`\`${repo}\` doesn’t exist or isn’t public.`)
    return result
  }
  if (info.private) errors.push(`\`${repo}\` must be public.`)
  if (info.archived) errors.push(`\`${repo}\` is archived.`)
  if (!info.hasIssues) warnings.push('Issues are disabled on your repository, so users can’t report problems.')
  if (!(await input.github.hasLicense(repo))) errors.push('Add a LICENSE file to your repository.')
  if (!(await input.github.getHeadFile(repo, 'README.md'))) errors.push('Add a README.md describing the plugin to your repository.')

  const manifestText = await input.github.getHeadFile(repo, 'manifest.json')
  let manifest = null
  try {
    manifest = manifestText ? JSON.parse(manifestText) : null
  } catch {
    manifest = null
  }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    errors.push('Your repository needs a valid `manifest.json` at the root of its default branch.')
    return result
  }
  for (const key of Object.keys(manifest)) if (!MANIFEST_KEYS.has(key)) errors.push(`\`manifest.json\` has an unknown property \`${key}\`.`)
  if (manifest.id !== id) errors.push(`The \`id\` in manifest.json (\`${manifest.id}\`) must equal the entry’s (\`${id}\`).`)
  if (manifest.name !== name) errors.push(`The \`name\` in manifest.json (\`${manifest.name}\`) must equal the entry’s (\`${name}\`).`)
  if (manifest.description !== description) errors.push('The `description` in manifest.json must equal the entry’s.')
  if (manifest.apiVersion !== 1) errors.push('`manifest.json` must declare `"apiVersion": 1`.')
  if (typeof manifest.version !== 'string' || !RELEASE_VERSION.test(manifest.version)) errors.push('The `version` in manifest.json must be plain MAJOR.MINOR.PATCH, like `1.0.0`.')
  if (manifest.minAppVersion !== undefined && (typeof manifest.minAppVersion !== 'string' || !SEMVER.test(manifest.minAppVersion))) errors.push('`minAppVersion` must be a version like `0.2.0`.')
  if (manifest.platforms !== undefined && (!Array.isArray(manifest.platforms) || !manifest.platforms.every((p) => p === 'desktop' || p === 'mobile'))) {
    errors.push('`platforms` must list "desktop" and/or "mobile".')
  }
  const files = ['main', 'renderer'].filter((field) => manifest[field] !== undefined).map((field) => manifest[field])
  if (typeof manifest.main !== 'string') errors.push('`manifest.json` needs a `main` file.')
  for (const file of files) if (typeof file !== 'string' || !ASSET_NAME.test(file)) errors.push(`\`${file}\` must be a top-level .js, .mjs or .cjs file (release assets are flat).`)
  if (errors.length > 0) return result

  // --- The release ----------------------------------------------------------------
  const release = await input.github.getRelease(repo, manifest.version)
  if (!release || release.draft) {
    errors.push(`No published GitHub release is tagged \`${manifest.version}\` (the version in manifest.json). Tags must not have a "v" prefix.`)
    return result
  }
  for (const asset of ['manifest.json', ...files]) {
    if (!release.assets.includes(asset)) errors.push(`Release \`${manifest.version}\` is missing \`${asset}\` as an individual file (not just inside the source code archive).`)
  }
  if (errors.length > 0) return result
  const releaseManifestText = await input.github.getReleaseAsset(repo, manifest.version, 'manifest.json')
  try {
    const releaseManifest = JSON.parse(releaseManifestText ?? '')
    if (releaseManifest.id !== id || releaseManifest.version !== manifest.version) {
      errors.push(`The manifest.json attached to release \`${manifest.version}\` must have the same \`id\` and \`version\`.`)
    }
  } catch {
    errors.push(`The manifest.json attached to release \`${manifest.version}\` is not valid JSON.`)
  }
  return result
}

export function formatReport(result) {
  if (result.skipped) return `ℹ️ ${result.warnings.join(' ')}`
  if (result.errors.length === 0 && result.warnings.length === 0) {
    return '✅ The automated checks passed. A maintainer will review your plugin.'
  }
  return [
    result.errors.length > 0 ? '❌ Please fix the following, then push to this pull request (the checks run again):' : '✅ The automated checks passed, with remarks:',
    '',
    ...result.errors.map((message) => `- ❌ ${message}`),
    ...result.warnings.map((message) => `- ⚠️ ${message}`)
  ].join('\n')
}

// --- GitHub REST reader (CI) ---------------------------------------------------------

/** @returns {GitHubReader} */
export function createGitHubReader(token, fetchImpl = fetch) {
  const api = async (path) => {
    const response = await fetchImpl(`https://api.github.com${path}`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'mindos-community-plugins-validator', ...(token ? { Authorization: `Bearer ${token}` } : {}) }
    })
    if (response.status === 404) return null
    if (!response.ok && response.status !== 204) throw new Error(`GitHub API ${path}: HTTP ${response.status}`)
    return response.status === 204 ? {} : response.json()
  }
  const raw = async (url) => {
    const response = await fetchImpl(url, { headers: { 'User-Agent': 'mindos-community-plugins-validator' } })
    if (!response.ok) return null
    const length = Number(response.headers.get('content-length') ?? 0)
    if (length > 1024 * 1024) return null
    return response.text()
  }
  return {
    async getRepo(repo) {
      const data = await api(`/repos/${repo}`)
      return data ? { private: Boolean(data.private), archived: Boolean(data.archived), hasIssues: Boolean(data.has_issues) } : null
    },
    async isOrgMember(org, user) {
      // 204 only for PUBLIC members when asked without org permissions — the same rule Obsidian used.
      return Boolean(await api(`/orgs/${encodeURIComponent(org)}/public_members/${encodeURIComponent(user)}`))
    },
    getHeadFile: (repo, path) => raw(`https://raw.githubusercontent.com/${repo}/HEAD/${path}`),
    async getRelease(repo, tag) {
      const data = await api(`/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`)
      return data ? { draft: Boolean(data.draft), assets: (data.assets ?? []).map((asset) => asset.name) } : null
    },
    getReleaseAsset: (repo, tag, name) => raw(`https://github.com/${repo}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(name)}`),
    async hasLicense(repo) {
      return Boolean(await api(`/repos/${repo}/license`))
    }
  }
}

// --- CLI ---------------------------------------------------------------------------------

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const env = process.env
  const readOptional = (path) => readFile(path, 'utf8').catch(() => '')
  const result = await validateSubmission({
    basePluginsText: await readFile(join(env.BASE_DIR ?? '.', PLUGINS_FILE), 'utf8'),
    prPluginsText: await readFile(join(env.PR_DIR ?? '.', PLUGINS_FILE), 'utf8'),
    removedText: await readOptional(join(env.BASE_DIR ?? '.', REMOVED_FILE)),
    changedFiles: (env.CHANGED_FILES ?? '').split('\n').map((line) => line.trim()).filter(Boolean),
    prAuthor: env.PR_AUTHOR ?? '',
    prBody: env.PR_BODY_FILE ? await readOptional(env.PR_BODY_FILE) : '',
    github: createGitHubReader(env.GITHUB_TOKEN)
  })
  const report = formatReport(result)
  console.log(report)
  if (env.REPORT_FILE) await writeFile(env.REPORT_FILE, report)
  process.exit(result.errors.length > 0 ? 1 : 0)
}
