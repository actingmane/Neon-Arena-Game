# GitHub + Cloudflare publishing

1. Put this `neon-clash-arena` folder under GitHub Desktop.
2. Publish the repository to GitHub.
3. In Cloudflare: Workers & Pages → Create application → Import a repository.
4. Select the GitHub repository.
5. Build command: leave blank.
6. Deploy command: `npx wrangler deploy`.
7. The repository root must contain `wrangler.jsonc`, `package.json`, `public/`, and `src/`.
