# Running in Windmill

The project runs in a [Windmill](https://www.windmill.dev) workspace as one runnable script, `create_tickets`, plus the rest of the source as shared-logic scripts in the same folder. It works on any Windmill plan.

## What you need

- **Workspace object storage** (S3, Azure Blob or similar), set in the workspace settings. Windmill workers keep nothing on disk between runs, so the score files, the record of issued tickets and the output files are kept there.
- **A Samsara API token** held in a Windmill variable or resource.

## How it is laid out

| Item | Path (example) | Purpose |
|---|---|---|
| Runnable script | `f/safety/raffle/create_tickets` | The job. Its inputs are the period, employee IDs, re-run mode and dry-run switch. |
| Shared logic | `f/safety/raffle/<name>` | One script per source file. They have no `main` and are imported by relative path. |
| Settings | variable `f/safety/raffle_settings` | The same settings as `.env`, as text. |
| Files | object storage, under `f/safety/raffle/` | `scores/`, `issued/` and `output/`, as in a local `data` folder. |

## Settings

Create a variable holding the settings as text, written exactly as in [.env.sample](../.env.sample). Secrets do not have to be written into it. A value can point at a Windmill variable or at one field of a resource:

```ini
SAMSARA_API_TOKEN=$var:f/samsara/api_token
RESEND_API_KEY=$res:f/resend/account#token
TIME_ZONE=America/Chicago
EXCLUDE_USERNAMES=Shop,Training
EMAIL_TRANSPORT=resend
EMAIL_FROM=raffle@example.com
EMAILS_TO=safety@example.com
```

`DATA_DIR` is ignored in Windmill; files go to object storage under the script's `storage_prefix` input.

## Deploying

Stage the scripts:

```sh
npm run build:windmill
```

This copies each source file into `windmill-dist/`, renames the entry file to `create_tickets.ts`, and writes a `manifest.json` of checksums. Create one Bun script in Windmill per file, all in the same folder, with the file's content unchanged. You can do that with the [Windmill CLI](https://www.windmill.dev/docs/advanced/cli), through Windmill's MCP server from an AI client, or by pasting into the editor.

Windmill installs the three packages the code imports (`pdf-lib`, `nodemailer` and `windmill-client`) by itself.

## Running

Run `create_tickets` with every input left at its default to process last month. Set `dry_run` to try it without recording or sending anything. The result lists the files written; Windmill shows them as downloads.

A run that cannot collect every day fails the job, after sending the failure notice. That makes it show as failed in Windmill's run list and triggers a workspace error handler if one is set.

## Scheduling

Add a schedule to `create_tickets` for the 3rd of the month, with a cron expression such as `0 0 7 3 * *` and your time zone, leaving the inputs at their defaults.
