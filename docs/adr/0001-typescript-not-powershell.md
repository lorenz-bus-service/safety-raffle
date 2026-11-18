# TypeScript, not PowerShell

Every other Lorenz automation repo is PowerShell, and the script this project replaces was PowerShell too. We chose TypeScript on Node because the project has to run three ways (a plain clone, a Docker image and a Windmill workspace) and has to produce a print-ready PDF in all of them. Windmill treats TypeScript as first-class and PowerShell as second-class, and PowerShell has no way to draw a PDF without a browser, which a Windmill worker does not have; a pure-JavaScript PDF library works identically everywhere.

## Consequences

- The project calls Samsara's REST API directly and does not use the PsSamsara module, which is not published on the PowerShell Gallery and would have been a manual install for anyone cloning the repo.
- There is no official Node image for Windows containers, so only a Linux image is shipped. Windows hosts run the project directly under Node, or run the Linux image through Docker Desktop.
