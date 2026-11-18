# Email

Email is off until `EMAIL_TRANSPORT` is set. Three ways of sending are supported. All of them need:

```ini
EMAIL_FROM=raffle@example.com
EMAILS_TO=safety@example.com,operations@example.com
EMAILS_CC=manager@example.com        # optional
```

## What gets sent

"Staff" below means the `EMAILS_TO` addresses, with `EMAILS_CC` copied.

| Email | To | When |
|---|---|---|
| Tickets | `EMAILS_TO` | Every successful run. Attaches the ticket PDF, the ticket CSV and the per-driver summary. |
| Failure notice | `EMAILS_TO` | A run that could not collect every day. Lists the days and the errors. No attachments, because no tickets were produced. |
| Your tickets | Each driver | Only when `SEND_DRIVER_EMAILS=true`. The driver's ticket count and qualifying days. |
| Driver email report | `EMAILS_TO` | Only when some driver emails could not be delivered. Names the drivers. |

Driver emails are sent last, after the files are written and the admin email has gone, because they cannot be recalled. Driver addresses come from the email field of each driver's Samsara record. A driver with no address is skipped and named in the report. One failed driver email does not stop the others.

Set `DRIVER_EMAIL_INCLUDE_NON_QUALIFYING=true` to also list the days that did not earn a ticket.

To try a run without emailing anyone, use `--no-email`, or `--no-driver-emails` to email only the admins.

## Microsoft 365: `graph`

Recommended for Microsoft 365. Microsoft is retiring username-and-password sign-in for SMTP: it is due to be switched off by default for existing organisations at the end of December 2026. Graph is unaffected.

A Microsoft 365 administrator does this once:

1. In the [Microsoft Entra admin centre](https://entra.microsoft.com), go to **App registrations** and choose **New registration**. Name it, for example, "Safety raffle". Leave the other fields as they are.
2. On the app's **Overview** page, copy the **Directory (tenant) ID** and the **Application (client) ID**.
3. Under **API permissions**, choose **Add a permission**, then **Microsoft Graph**, then **Application permissions**, and add **Mail.Send**. Then choose **Grant admin consent**.
4. Under **Certificates & secrets**, create a **New client secret** and copy its **Value** straight away; it is shown only once. Note the expiry date: sending stops when the secret expires.
5. Recommended: restrict the app to the one sending mailbox. By default, Mail.Send lets the app send as any mailbox in the organisation. See Microsoft's guide to [limiting application permissions to specific mailboxes](https://learn.microsoft.com/en-us/graph/auth-limit-mailbox-access).

Then in `.env`:

```ini
EMAIL_TRANSPORT=graph
EMAIL_FROM=raffle@example.com        # the mailbox the app sends as
GRAPH_TENANT_ID=...
GRAPH_CLIENT_ID=...
GRAPH_CLIENT_SECRET=...
```

## Any mail server: `smtp`

```ini
EMAIL_TRANSPORT=smtp
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false        # true for port 465
SMTP_USERNAME=raffle@example.com
SMTP_PASSWORD=...
```

Leave `SMTP_USERNAME` empty for a relay that does not need sign-in.

## Resend: `resend`

Create an API key at [resend.com](https://resend.com) and verify the domain you send from.

```ini
EMAIL_TRANSPORT=resend
EMAIL_FROM=raffle@example.com
RESEND_API_KEY=re_...
```

## Slack and Teams

Independent of email. Set either or both:

```ini
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
TEAMS_WEBHOOK_URL=https://...
NOTIFY_ON_SUCCESS=true
```

- **Slack**: create an [incoming webhook](https://api.slack.com/messaging/webhooks) for the channel.
- **Teams**: in the channel, add a workflow from the template "Post to a channel when a webhook request is received" and copy its address.

Failures are always posted. Successes are posted when `NOTIFY_ON_SUCCESS=true`, so that a month with no message means the job did not run.

## Sources

- [Microsoft: Exchange Online to retire Basic auth for Client Submission (SMTP AUTH)](https://techcommunity.microsoft.com/blog/exchange/exchange-online-to-retire-basic-auth-for-client-submission-smtp-auth/4114750)
