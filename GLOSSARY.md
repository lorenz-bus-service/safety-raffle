# Safety Raffle

Rewards safe driving by turning each driver's daily Samsara safety score into raffle tickets, printed on label sheets once a month.

## Language

**Driver**:
A person who operates a vehicle and has a driver record in Samsara.
_Avoid_: Employee, operator

**Deactivated Driver**:
A Driver whose Samsara record has been deactivated because they have left the organisation. A Deactivated Driver earns no Tickets.
_Avoid_: Inactive, terminated

**Employee ID**:
The organisation's own identifier for a Driver, printed on each Ticket to tell apart Drivers who share a name.
_Avoid_: Username, employee number, driver ID

**Safety Score**:
Samsara's 0–100 rating of how safely a Driver drove over a period.
_Avoid_: Score (alone), rating

**Driver-Day**:
One Driver on one calendar day; the unit a Safety Score and Miles Driven are measured over, and the unit that earns a Ticket.

**Miles Driven**:
The whole-mile distance a Driver covered on a Driver-Day.
_Avoid_: Mileage, distance

**Daily Score**:
The Safety Score and Miles Driven recorded for a Driver-Day, as they stood when collected.
_Avoid_: Record, row

**Collection**:
Capturing the Daily Scores for a calendar day from Samsara.
_Avoid_: Import, sync, fetch

**Re-collection**:
Repeating Collection for a day already collected, replacing its Daily Scores to pick up a Revision.
_Avoid_: Regenerate, refresh

**Revision**:
A change to a past Safety Score made in Samsara after staff review a safety event.
_Avoid_: Correction, adjustment

**Minimum Score**:
The lowest Safety Score that qualifies a Driver-Day for a Ticket; the score itself qualifies.
_Avoid_: Threshold

**Minimum Miles**:
The Miles Driven a Driver-Day must exceed to qualify for a Ticket; exactly this many does not qualify.
_Avoid_: Threshold

**Ticket**:
One raffle entry earned by a Driver for a Driver-Day that meets the Minimum Score and exceeds the Minimum Miles.
_Avoid_: Label, entry

**Exclusion**:
A rule naming Drivers who never earn Tickets, such as shared placeholder accounts, identified by username, tag or attribute.
_Avoid_: Filter, blocklist

**Supplementary Run**:
A repeat run for a Raffle Period that already has Tickets, issuing only the Tickets earned since the previous run.
_Avoid_: Reprint, regeneration

**Full Reprint**:
A repeat run for a Raffle Period that issues every Ticket again, replacing the earlier set.

**Raffle Period**:
The calendar month whose Driver-Days are turned into Tickets.
_Avoid_: Date range
