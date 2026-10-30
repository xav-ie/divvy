# divvy

## 0.4.0

### Minor Changes

- c971729: Every group's Expenses tab has an Export CSV link that downloads the group's
  expenses, payments and balances — cents as dollars, dates as written, quotes
  where commas need them — for taxes, rent ledgers or anything else that wants
  a spreadsheet.

## 0.3.0

### Minor Changes

- a3dd541: Installing divvy on Android shows screenshots of the app. Long-press the app
  icon for Add expense and Settle up shortcuts. Share a receipt photo from your
  gallery to divvy to start an expense with it; divvy reads the items when
  receipt scanning is on.

### Patch Changes

- a3dd541: The installed app and Chrome's toolbar use divvy's green (mint in dark mode)
  as the theme color.

## 0.2.0

### Minor Changes

- 3b91bc9: Profile shows which version you're on and offers an update when a newer one
  has been deployed since the app was opened.
- 3b91bc9: divvy now offers to install itself: a dismissible card on Home and an Install
  button in Profile (on iPhone and iPad, the Add to Home Screen steps). It can
  also send push notifications when someone adds an expense you're on or
  records a payment to or from you. Turn them on per device in Profile, which
  also has switches for each kind; the installed app offers them once too.

### Patch Changes

- 3b91bc9: The installed app on Android now opens full screen, so no white system
  navigation bar shows under it; swipe from the edge to bring the system bars
  back.

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
