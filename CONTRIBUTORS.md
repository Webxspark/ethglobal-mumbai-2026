# Contributors

Who commits what, under which identity.

Each person commits their own work under their own name and mailbox, at the time
they actually commit. No shared identity, no reassigning commits after the fact.

| Name | Email | Handle |
| --- | --- | --- |
| Allan Christofer | alanchris@webxspark.com | [@Webxspark](https://github.com/Webxspark) |
| Mary Judity Sylvia | mary@webxspark.com | [@maryjudy](https://github.com/maryjudy) |
| Jayna Mukesh | jayna@webxspark.com | [@JaynaMukesh](https://github.com/JaynaMukesh) |
| Mukeshwar R M | mukeshwar.1010@gmail.com | [@Mukesh-RM](https://github.com/Mukesh-RM) |

## Committing

Set your identity in your clone once:

```bash
git config user.name "Your Name"
git config user.email "you@example.com"
```

Or, if several people share one checkout, commit a specific set of paths under
the right identity:

```bash
./scripts/commit-as.sh allan "Add nearby feed geo projection" apps/web/src/app/feed/nearby
./scripts/commit-as.sh mary "Build the worker message thread UI" apps/web/src/components/messages
```

Preview what would be committed without committing:

```bash
./scripts/commit-as.sh jayna "Document the x402 flow" docs/mcp-x402.md --preview
```

The helper refuses credentials (`.env`, `*.pem`, `*.key`) and refuses to stage
content that contains a live token or private key.

## Pushing

Use your own personal access token with `contents: write` on this repository:

```bash
GITHUB_TOKEN=<your own PAT> ./scripts/push-as.sh
```

The token is passed through `GIT_ASKPASS`, so it is never written to
`.git/config`, embedded in the remote URL, or left in shell history. Do not
commit or share tokens.

## Authoring

Commit messages describe what changed and why, in the imperative mood
("Add…", "Fix…", "Document…"). Attribution to more than one person goes in a
`Co-authored-by:` trailer when the work was genuinely shared:

```
Add escrow refund path for expired claims

Co-authored-by: Jayna Mukesh <jayna@webxspark.com>
```
