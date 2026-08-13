# Publishing Codegraph Studio

This guide covers everything needed to publish **Codegraph Studio** to the VS
Code Marketplace (and, optionally, Open VSX) — both the **one-time setup** and
the **recurring release** flow. Once setup is done, publishing a new version is
just "bump the version and merge to `main`"; the [Release workflow](../.github/workflows/release.yml)
does the rest.

> **Marketplace identity:** publisher `stovberpv`, extension id
> `stovberpv.codegraph-studio`.

---

## 1. One-time setup

### 1.1 Create a Marketplace publisher

1. Sign in to the [Visual Studio Marketplace management page](https://marketplace.visualstudio.com/manage)
   with the Microsoft/Entra account you want to own the extension.
2. Create a publisher whose **ID is `stovberpv`** (it must match `publisher` in
   `package.json`). If you use a different ID, update `package.json` and every
   `stovberpv.codegraph-studio` reference in `README.md` and the badges.

### 1.2 Create a Personal Access Token (PAT) for the Marketplace

The token authenticates `vsce publish`.

1. Go to <https://dev.azure.com/> and sign in with the **same** account as the
   publisher. If you have no organization yet, create one (any name works — it is
   only used to mint the token).
2. **User settings → Personal access tokens → New Token.**
   - **Organization:** *All accessible organizations* (important).
   - **Expiration:** up to 1 year (you will need to rotate it later).
   - **Scopes:** *Custom defined* → **Marketplace → Manage**.
3. Copy the token immediately — you cannot view it again.

Verify locally (optional but recommended):

```bash
npx @vscode/vsce login stovberpv   # paste the PAT when prompted
```

### 1.3 (Optional) Create an Open VSX token

Open VSX is the marketplace used by VSCodium, Cursor, Gitpod, etc. It is a
**separate** service from the VS Code Marketplace — the Azure DevOps PAT from
step 1.2 does **not** work here. You mint a dedicated Open VSX access token.

1. **Sign in.** Go to <https://open-vsx.org/> and log in with GitHub.
2. **Sign the Publisher Agreement (first time only).** Open your avatar
   (top-right) → **Settings → Profile**, then follow the prompt to read and sign
   the *Eclipse Foundation Open VSX Publisher Agreement*. Publishing is rejected
   until this is signed.
3. **Generate the access token.** Avatar → **Settings → Access Tokens** →
   **Generate New Token**, give it a description (e.g. `codegraph-ci`), and
   **copy it now** — it is shown only once. This copied string is the
   `<token>` / `OVSX_PAT` used everywhere below.
4. **Create the namespace** (once), using the token from step 3:

   ```bash
   npx ovsx create-namespace stovberpv -p <token>
   ```

If you skip Open VSX entirely, the Open VSX steps/badges are simply inactive —
nothing breaks.

### 1.4 Add the tokens as GitHub Actions secrets

In the GitHub repo: **Settings → Secrets and variables → Actions → New
repository secret**.

| Secret name | Value | Required |
| --- | --- | --- |
| `VSCE_PAT` | Azure DevOps PAT from step 1.2 | Yes |
| `OVSX_PAT` | Open VSX token from step 1.3 | Optional |

The workflow fails fast with a clear message if `VSCE_PAT` is missing when a
release is due.

### 1.5 Marketplace icon

The manifest ships a **128×128** `media/icon.png` (referenced by `"icon"` in
`package.json`), so the listing shows the project icon. A 256×256
`media/icon@2x.png` is kept in the repo for docs/README use but excluded from the
VSIX. To replace the icon, overwrite `media/icon.png` with another 128×128 PNG.

---

## 2. Release a new version (recurring)

Releases are driven by the version in `package.json`. The
[Release workflow](../.github/workflows/release.yml) publishes **only** when it
sees a version that has no matching `vX.Y.Z` git tag, so ordinary merges to
`main` never re-publish or fail.

1. **Update the changelog.** Move items from `Unreleased` into a new version
   section in [`CHANGELOG.md`](../CHANGELOG.md).
2. **Bump the version.** Use one of:

   ```bash
   npm version patch --no-git-tag-version   # 0.1.0 -> 0.1.1
   npm version minor --no-git-tag-version   # 0.1.0 -> 0.2.0
   npm version major --no-git-tag-version   # 0.1.0 -> 1.0.0
   ```

   > `--no-git-tag-version` keeps tagging in the hands of the workflow, which
   > tags the commit that actually lands on `main`.
3. **Open a PR** with the version + changelog changes. CI type-checks, builds,
   and produces a VSIX artifact you can download and sanity-check.
4. **Merge to `main`.** The Release workflow then:
   - re-checks the version against existing tags;
   - runs `npm run build:prod` and packages the VSIX;
   - `vsce publish` to the VS Code Marketplace (and `ovsx publish` if `OVSX_PAT`
     is set);
   - creates tag `vX.Y.Z` and a GitHub Release with the `.vsix` attached and
     auto-generated notes.

Marketplace propagation typically takes a few minutes; verify at
<https://marketplace.visualstudio.com/items?itemName=stovberpv.codegraph-studio>.

---

## 3. Manual / local publish (fallback)

If you ever need to publish outside CI:

```bash
npm ci
npm run typecheck
npm run package                       # builds prod + writes codegraph-studio-<version>.vsix

# Publish the packaged VSIX
npx @vscode/vsce publish --no-dependencies -p "$VSCE_PAT" \
  --packagePath codegraph-studio-<version>.vsix

# Optional: Open VSX
npx ovsx publish codegraph-studio-<version>.vsix -p "$OVSX_PAT"
```

To only build and install the VSIX locally (no publish):

```bash
npm run package
# VS Code → Extensions → "Install from VSIX…" → pick the .vsix
```

---

## 4. Pre-publish checklist

- [ ] `publisher` in `package.json` matches your Marketplace publisher ID.
- [ ] Version bumped and `CHANGELOG.md` updated.
- [ ] `npm run typecheck` and `npm run package` pass locally.
- [ ] `media/icon.png` present and referenced by `package.json`.
- [ ] `VSCE_PAT` (and optionally `OVSX_PAT`) set as GitHub Actions secrets.
- [ ] `README.md` renders correctly (images use absolute
      `raw.githubusercontent.com` URLs so they show on the Marketplace).
- [ ] The `media/preview.gif` / `media/preview.mp4` referenced by the README are
      committed and pushed to `main`.

---

## 5. Troubleshooting

- **`401 Unauthorized` on publish** — the PAT is wrong, expired, or was created
  without *All accessible organizations* + *Marketplace: Manage* scope. Recreate
  it (step 1.2) and update the `VSCE_PAT` secret.
- **`Extension version X.Y.Z already exists`** — you did not bump the version.
  Bump it and merge again.
- **README images missing on the Marketplace** — the Marketplace only renders
  images served over HTTPS. Keep using absolute `raw.githubusercontent.com`
  URLs, not repo-relative paths.
- **Release workflow did nothing after a merge** — expected when the version was
  unchanged (a `::notice::` says it skipped). Bump the version to release.
