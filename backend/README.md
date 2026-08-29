# Private reading dashboard

This Worker stores anonymous article views, completion events, and private
reader messages in Cloudflare D1. The public site remains on GitHub Pages.

## Privacy and behavior

- No cookies and no persistent reader identifier.
- A fresh random view ID is created for each article load.
- A view is recorded after the page remains visible for three seconds.
- Completion is recorded only after at least fifteen seconds and when the
  reader reaches the end marker after the article text.
- Raw IP addresses are never stored. A salted hash is retained only to limit
  messages to five per hour per sender.
- Counts and messages appear only at the password-protected `/admin` route.
- A reader can optionally attach a selected passage and its paragraph number to
  a private message. That context is shown only in the protected dashboard.
- The private dashboard can filter statistics to 7 days, 30 days, or all time,
  and export article-level figures as CSV. That CSV never contains messages or
  email addresses.
- The password-protected `Private backup` download contains raw reading events
  and private messages, including any quoted passage, so they can be kept
  offline. It excludes the sender hash used for rate limiting and never
  contains a raw IP address.

## Deployment

1. Install dependencies with `pnpm install` and authenticate Wrangler with
   `pnpm exec wrangler login`.
2. Create the database: `pnpm exec wrangler d1 create rxxldq-insights`.
3. Put its `database_id` in `wrangler.jsonc`.
4. Create the tables: `pnpm run db:remote`.
5. Set `ADMIN_PASSWORD` and `RATE_SALT` with
   `pnpm exec wrangler secret put NAME`.
6. Deploy: `pnpm run deploy`.
7. Put the resulting `https://...workers.dev` URL in the root `_config.yml` as
   `insights_endpoint`, rebuild, test, and publish the site.

The admin page uses HTTP Basic authentication with timing-safe credential
comparison. Its username is `rxxldq`; the password is the encrypted Worker
secret and is never committed to Git.
