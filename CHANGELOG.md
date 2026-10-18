# divvy

## 0.1.1

### Patch Changes

- 01854c8: On Android, the installed app no longer forces its green theme color onto the
  system navigation bar; the bar follows the phone's light or dark theme.

## 0.1.0

### Minor Changes

- 666c205: divvy runs on Cloudflare Workers: one Durable Object holds the database, R2
  keeps receipts and attachments, Workers AI reads receipts, and a daily cron
  bills recurring expenses. Deploy your own with the Deploy to Cloudflare
  button.
