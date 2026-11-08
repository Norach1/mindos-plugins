# MindOs community plugins

This repository is the directory of community plugins for MindOs. MindOs reads it to fill **Settings → Plugins → Browse**.

It works like Obsidian's [`obsidian-releases`](https://github.com/obsidianmd/obsidian-releases): it lists plugins and **points to their GitHub repositories**. It holds no plugin code, versions, download links or checksums. Each author publishes releases in their own repository, and MindOs downloads them from there. An update never needs a change here.

## Files

| File | Contents |
|---|---|
| `community-plugins.json` | The listed plugins: `[{ "id", "name", "author", "description", "repo" }]` |
| `community-plugins-removed.json` | Plugins taken out of the directory: `[{ "id", "name", "reason" }]`. MindOs warns users who still have one installed. Ids listed here can't be reused. |
| `community-plugin-deprecation.json` | Versions that must not be installed: `{ "<id>": ["1.0.0", …] }`. MindOs never offers them, falls back to an older release when `versions.json` names one, and warns users who have one installed. |

MindOs reads these three files from the HEAD of the default branch (`main`). Missing optional files count as empty.

## How MindOs uses a listing

1. `community-plugins.json` gives the plugin's `repo`.
2. MindOs reads `manifest.json` on that repository's default branch. Its `version` is the latest version.
3. If that version needs a newer MindOs (`minAppVersion`) or is deprecated here, MindOs reads `versions.json` on the default branch (`{ "<plugin version>": "<minAppVersion>" }`) and offers the newest older release that fits.
4. MindOs downloads `manifest.json` and the files that manifest names (`main`, and `renderer` if any) from the **published** release tagged exactly with that version: `https://github.com/<repo>/releases/download/<version>/<file>`. The release's `manifest.json` must have the same `id` and `version`.
5. Before installing, the user sees a confirmation naming the repository and the release. The plugin is installed **switched off**. It runs only after the user switches it on and allows it.

## Submitting a plugin

1. **Prepare your repository.** It must be public, with a `README.md` that explains what the plugin does, a `LICENSE`, and a valid `manifest.json` at the root of the default branch. The MindOs sample plugin template has all of this, plus a release workflow.
2. **Publish a release.** Set `version` in `manifest.json` to plain `MAJOR.MINOR.PATCH` (for example `1.0.0`). Create a GitHub release whose **tag is exactly that version**, with no `v` prefix. Attach `manifest.json` and every file the manifest names (`main`, and `renderer` if any) as **individual files**. Publish the release: drafts aren't visible to MindOs.
3. **Open a pull request** that adds one entry **at the end** of `community-plugins.json`:

   ```json
   {
     "id": "word-goals",
     "name": "Word Goals",
     "author": "Ada Lovelace",
     "description": "Set daily writing targets and track your progress.",
     "repo": "ada/word-goals"
   }
   ```

   Use the **plugin** pull request template and keep every checklist line. Open the pull request from the GitHub account that owns the repository, or as a **public** member of the owning organization.
4. **The automated check** comments on your pull request. If it finds a problem, fix it and push again; the check reruns. A maintainer then reviews the plugin and merges it.

After the merge, your plugin appears in MindOs within minutes. To ship an update later, publish a new release and bump `version` in `manifest.json` on your default branch. Nothing changes here.

### Rules the automated check enforces

- Only `community-plugins.json` changes, and exactly one entry is added, at the end. Existing entries are not touched.
- The entry has exactly `id`, `name`, `author`, `description` and `repo`, all as text.
- `id`: 2–64 lowercase letters, digits and single hyphens. It is unique, contains no `mindos`, doesn't end with `plugin`, and wasn't used by a removed plugin. It becomes the plugin's folder name and can never change.
- `name`: unique, at most 100 characters, contains no "MindOs", doesn't end with "Plugin".
- `description`: at most 250 characters, ends with `.`, `?`, `!` or `)`, doesn't mention MindOs.
- `repo`: `owner/name`, unique. The pull request author owns it or is a public member of the owning organization. The repository is public, not archived, and has a LICENSE and a README.md.
- `manifest.json` on the default branch has the same `id`, `name` and `description`, declares `"apiVersion": 1`, uses a plain `MAJOR.MINOR.PATCH` version, and names its entry files as top-level `.js`, `.mjs` or `.cjs` files.
- A published release tagged with that version has `manifest.json` and every entry file attached, and the attached `manifest.json` has the same `id` and `version`.

### Guidelines reviewers look at

- The README states plainly what the plugin accesses: network requests (which servers, and why), files outside the vault, other programs it starts, any data it collects.
- No obfuscated or minified-only code without readable source in the repository.
- No hidden network activity, telemetry without consent, ads, or self-update mechanisms that bypass releases.
- Respect the licenses of any code you reuse, and credit it in your README.

## Maintaining the directory

- **Accepting a plugin:** merge the pull request once the check passes and the review is done.
- **A harmful or broken release:** add its version to `community-plugin-deprecation.json`. MindOs stops offering it and warns users who have it installed.
- **Removing a plugin:** delete its entry from `community-plugins.json` and add `{ "id", "name", "reason" }` to `community-plugins-removed.json`. The reason is shown to users who still have the plugin installed.
- **Repository moved or renamed:** update `repo` in a maintainer pull request.

Protect the `main` branch: require pull requests, require the validation check to pass, and require review by a maintainer. Anyone with write access to this repository decides what MindOs users are offered.

## Security model

Being listed means a maintainer accepted the plugin. It does **not** mean every release was reviewed, and it is not a guarantee that a plugin is safe. MindOs plugins run with the same access as MindOs itself.

- **What GitHub provides:** HTTPS transport, account authentication, the protected history of this repository, and the release files as each author published them.
- **What MindOs adds:** it only contacts `github.com` and GitHub's content hosts. It caps every download's size, removes partial downloads, and installs only after checking that the release's `manifest.json` is exactly the plugin and version the user confirmed. Every install, update and restore runs as a recoverable transaction. Plugins are installed switched off and need the user's explicit approval to run.
- **What nobody checks automatically:** the code itself. Whoever controls a plugin's repository controls what its users install next. Authors should use two-factor authentication and GitHub's immutable releases, and should attest their builds (the sample plugin's workflow does).
