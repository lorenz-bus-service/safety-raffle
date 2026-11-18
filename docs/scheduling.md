# Scheduling

The job runs once and exits. Use whatever scheduler the host already has to start it each month.

With no dates given, `run` processes the previous calendar month.

## When to run it

Schedule it for the **3rd of the month**, not the 1st. Samsara revises past safety scores when staff review, dismiss or coach safety events, and a run on the 1st would collect the last days of the month before anyone has reviewed them. If your staff take longer to review events, schedule it later.

If a score is revised after the tickets have been handed out, run the same period again. By default the second run prints only the newly earned tickets.

Expect the admin email by the scheduled date each month. If the server was off or the scheduler did not fire, the project cannot report it; the missing email is the only sign. Setting a Slack or Teams webhook with `NOTIFY_ON_SUCCESS=true` gives a second place to notice the silence.

## Linux or macOS: cron

Run at 07:00 on the 3rd of every month:

```cron
0 7 3 * * cd /opt/safety-raffle && /usr/bin/npm run --silent raffle -- run >> /var/log/safety-raffle.log 2>&1
```

## Windows: Task Scheduler

From an elevated prompt, adjusting the folder. This creates a task that runs at 07:00 on the 3rd of every month:

```powershell
schtasks /Create /TN "Safety Raffle" /SC MONTHLY /D 3 /ST 07:00 /TR "cmd /c cd /d C:\Apps\safety-raffle && node src\cli.ts run"
```

Task Scheduler records the exit status of each run as the task's "Last Run Result": `0` is success, `1` is failure.

## Docker

Schedule a `docker run` from the host's scheduler. With cron:

```cron
0 7 3 * * docker run --rm --env-file /opt/safety-raffle/.env -v /opt/safety-raffle/data:/data safety-raffle run >> /var/log/safety-raffle.log 2>&1
```

## Windmill

Support for running inside a Windmill workspace is planned and not yet built.

## Exit status

| Status | Meaning |
|---|---|
| `0` | Success. |
| `1` | Failure: nothing was produced, or the tickets were produced but the admin email could not be sent. The log and the failure notice say which. |
| `2` | Only from `compare`: the comparison ran and found differences. |
