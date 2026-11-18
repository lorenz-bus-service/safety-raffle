# Safety raffle

Turns Samsara driver safety scores into printable raffle tickets.

Once a month, the job collects every driver's safety score for each day of the previous month, awards one ticket for each day a driver drove safely, and writes a print-ready PDF laid out for label or perforated card sheets. It can email the results to staff and tell each driver how many tickets they earned.

![A sheet of sample tickets](docs/sample-tickets.png)

A full sample is in [docs/sample-tickets.pdf](docs/sample-tickets.pdf). Every name in it is invented.

## The rule

A driver earns **one ticket for each calendar day** on which:

- their safety score is **90 or higher**, and
- they drove **more than 20 miles**.

Both numbers are settings. Exactly 20 miles earns nothing, and miles are rounded to the nearest whole mile first. There is no limit on tickets per driver.

Each ticket shows the driver's name, the date, the safety score, the miles driven and, in small print, their employee ID.

## Quick start

You need [Node.js](https://nodejs.org) 22.18 or later and a Samsara API token with read access to **Drivers** and to **Safety Events & Scores**.

```sh
git clone https://github.com/lorenz-bus-service/safety-raffle.git
cd safety-raffle
npm ci
cp .env.sample .env        # then put your Samsara token in .env
npm run raffle -- run --dry-run
```

`--dry-run` writes the files without recording anything or sending any email, so it is safe to try. The PDF, a CSV of every ticket and a per-driver summary appear under `data/output/`.

When the tickets look right, run it without `--dry-run`.

## Commands

| Command | What it does |
|---|---|
| `npm run raffle -- run` | Collects last month, generates tickets, sends email if configured. |
| `npm run raffle -- run --period 2026-10` | The same, for a named month. |
| `npm run raffle -- run --from 2026-10-12 --to 2026-10-18` | The same, for any range of days. |
| `npm run raffle -- run --employee-id ab1234,cd5678` | Restricts a run to particular employee IDs. |
| `npm run raffle -- collect --date 2026-10-14` | Re-collects scores for a day (or `--from`/`--to`, or `--period`) without generating tickets. |
| `npm run raffle -- test-page` | Writes a sheet of label outlines for checking printer alignment. |
| `npm run raffle -- compare --csv old.csv --period 2026-10` | Compares this project's tickets with a CSV from the earlier PowerShell script. |
| `npm run raffle -- --help` | Lists every option. |

Useful options for `run`: `--dry-run`, `--no-email`, `--no-driver-emails`, `--full`, `--supplementary`, `--no-collect`.

## Settings

All settings live in `.env`. [.env.sample](.env.sample) documents every one with its default. The main ones:

| Setting | Default | Meaning |
|---|---|---|
| `SAMSARA_API_TOKEN` | none | Required. |
| `TIME_ZONE` | `America/Chicago` | Where each day's midnight falls. US zones are listed in `.env.sample`. |
| `MINIMUM_SCORE` / `MINIMUM_MILES` | `90` / `20` | The ticket rule. |
| `INCLUDE_DEACTIVATED_DRIVERS` | `true` | Whether drivers deactivated since they drove still earn tickets. |
| `EXCLUDE_USERNAMES`, `EXCLUDE_TAGS`, `EXCLUDE_ATTRIBUTES` | empty | Drivers who never earn tickets, such as shared placeholder accounts. |
| `EMPLOYEE_ID_SOURCE` | `username` | The Samsara username, or the name of an external ID. |
| `LABEL_LAYOUT` | `avery-5160` | The sheet. See [docs/label-stock.md](docs/label-stock.md). |
| `RERUN_MODE` | `supplementary` | What a second run for the same period prints. |
| `EMAIL_TRANSPORT` | `none` | `smtp`, `graph` or `resend`. See [docs/email.md](docs/email.md). |
| `SEND_DRIVER_EMAILS` | `false` | Email each driver their ticket count. |

## Things to know

**The time zone matters.** It decides which day a late-night drive belongs to. Samsara counts a trip in the window in which it *ends*, so an overnight trip that leaves at 9pm and arrives at 2am counts entirely toward the second day. The time zone in use is printed at the start of every run and in the admin email.

**Scores are collected fresh at every run.** Samsara revises past scores when staff review safety events. Each run collects the whole period again, so it sees the scores as they stand at that moment. Run the job a few days after month end to give reviews time to settle. See [docs/scheduling.md](docs/scheduling.md).

**Running a period again prints only what is new.** The project remembers which tickets it has issued. If a score is revised after the tickets were handed out, run the same period again and it prints a supplementary sheet with only the tickets that are newly earned. It also reports any ticket issued earlier that no longer qualifies; it never takes one back. Use `--full` to reprint everything.

**It is all or nothing.** If any day cannot be collected from Samsara after retries, the run stops, produces no tickets and reports the failure by email and, if configured, Slack or Teams. It exits with a failure status so your scheduler records it. Starting it again within six hours fetches only the days that are still missing.

**Names with unusual characters.** The PDF uses a built-in font that covers Western European characters. Letters outside that range are printed without their accents where possible, and as `?` otherwise.

## Printing

Print the PDF at **100% scale** ("actual size"), not "fit to page". Before using real stock, print the alignment page on plain paper and hold it against a label sheet up to the light:

```sh
npm run raffle -- test-page
```

If the outlines are slightly off, adjust `PRINT_OFFSET_X_MM` and `PRINT_OFFSET_Y_MM` in `.env` and try again.

## Docker

```sh
docker build -t safety-raffle .
docker run --rm --env-file .env -v "$PWD/data:/data" safety-raffle run --dry-run
```

The container runs once and exits. Everything it keeps (score files, issued-ticket records, output and logs) is written to `/data`, so mount a folder there. The image is Linux only; on a Windows server without Docker, run the project directly under Node.

## Where things are kept

Under `DATA_DIR` (default `./data`, which git ignores):

| Folder | Contents |
|---|---|
| `scores/` | One file per day with every driver's score and distance, as collected. |
| `issued/` | One file per month recording the tickets issued. |
| `output/` | One folder per run with the PDF, the ticket CSV and the summary CSV. |
| `logs/` | One log file per day. |

These files hold drivers' names and safety records. Keep them out of version control and treat them as personal data.

## Development

```sh
npm test            # run the tests
npm run typecheck   # check types
npm run sample      # regenerate docs/sample-tickets.pdf from invented data
```

The source is TypeScript and runs directly under Node with no build step. Terms used in the code are defined in [GLOSSARY.md](GLOSSARY.md), and the reasons behind the main design choices are in [docs/adr/](docs/adr/).

## Licence

MIT. See [LICENSE](LICENSE).
