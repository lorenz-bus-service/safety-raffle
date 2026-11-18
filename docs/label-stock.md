# Label and ticket stock

Tickets print one per label on label or card sheets, US Letter or A4. The sheet layout is a setting, so you can use whichever stock suits how you separate and hand out tickets.

## Choosing a stock

| Stock | `LABEL_LAYOUT` | Ticket size | Per sheet | Separation | Sheets per 1,000 tickets |
|---|---|---|---|---|---|
| Avery 5160 address labels (default) | `avery-5160` | 1" × 2⅝" | 30 | Cut by hand | 34 |
| Avery 5371 business cards | `avery-5371` | 2" × 3½" | 10 | Tear along micro-perforations | 100 |
| Avery L7160 address labels (A4) | `avery-l7160` | 63.5 mm × 38.1 mm | 21 | Cut by hand | 48 |
| Avery 16154 tickets with tear-away stubs | `custom` | 1¾" × 5½" | 10 | Tear along micro-perforations | 100 |
| Blanks USA 810X9WH small raffle tickets | `custom` | about 2⅛" × 5½" | 8 | Tear along micro-perforations | 125 |

Stock marked `custom` has no built-in layout, because its exact margins have not been measured. Measure a sheet and enter the numbers under `LABEL_LAYOUT=custom` in `.env`; `.env.sample` lists the settings. Print the alignment page (`npm run raffle -- test-page`) on plain paper to check any layout before using real stock.

- **Avery 5160** uses the fewest sheets, but the labels have to be cut apart if tickets are handed out loose instead of being stuck to something.
- **Avery 5371** is the recommended perforated option. It needs no cutting, and comes 250 cards to a pack. Most retailers list it as laser-only; check the packaging against your printer.
- **Avery 16154** works, but comes in packs of only 200 tickets, and the stub has no use when the driver keeps the whole ticket.
- **Blanks USA 810X9WH** is a larger ticket on 90 lb index stock, rated for laser and inkjet printers.

Perforated stock uses about three times as many sheets as Avery 5160 and is heavier card, so expect a higher paper cost in exchange for no cutting. No perforated stock at 30 per sheet was found when this was written (November 2026).

## Where to buy

Office suppliers such as Staples, Office Depot and Quill, and Amazon, carry these products. Search for the product number, or for "micro-perforated" business cards or raffle tickets.

## Sources

Product specifications above were taken from these pages in November 2026. Check them before ordering, since pack sizes and printer compatibility change.

- [Avery 16154 product page](https://www.avery.com/products/cards/16154)
- [Avery 16154 at Zoro](https://www.zoro.com/avery-printable-tickets-wtear-away-stubs-16154-8-12-x-11-matte-white-200pack-16154/i/G504950808/)
- [Avery 5371 template page](https://www.avery.com/templates/5371)
- [Avery 5371 at Staples](https://www.staples.com/avery-laser-business-cards-2-x-3-5-white-250-pack-05371/product_AVE5371)
- [Avery 10-per-sheet business card help article](https://www.avery.com/help/article/avery-business-cards-2-inch-x-3%20and-1-2-inch-10-per-sheet)
- [Blanks USA small raffle ticket (810X9WH) at OnTimeSupplies](https://www.ontimesupplies.com/bla810x9wh-small-micro-perforated-event-raffle-ticket-90-lb-index-weight-85-x-11-white-8-tickets-sheet-125-sheets-pack.html)
- [Blanks USA jumbo raffle ticket (10X9WH) at OfficeCrave](https://www.officecrave.com/blanks-usa-jumbo-micro-perforated-event-raffle-ticket-90-lb-8-5-x-11-white-4-tickets-sheet-250-sheets-pack-10x9wh.html)
