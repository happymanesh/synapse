# Synapse document set

| Document | Source | Output | Audience |
|---|---|---|---|
| Business Requirements Specification | `01-business-requirements.html` | `01-business-requirements.pdf` | Business stakeholders, product owners, compliance |
| Technical Architecture | `02-technical-architecture.html` | `02-technical-architecture.pdf` | Engineers, architects, DBAs, operations |
| User Guidelines | `03-user-guidelines.html` | `03-user-guidelines.pdf` | All staff (Part A) and administrators (Part B) |

The HTML files are the source of truth — edit those, not the PDFs. All three share
`assets/print.css`, which carries the A4 page setup, the SIHL palette and the page-break
rules, so a change there restyles the whole set.

## Regenerating the PDFs

Rendered with headless Chrome, so there is no documentation toolchain to install and
nothing added to `package.json`:

```powershell
$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$docs   = "C:\Projects\Synapse\docs"
foreach ($f in @("01-business-requirements","02-technical-architecture","03-user-guidelines")) {
  & $chrome --headless --disable-gpu --no-pdf-header-footer `
            --run-all-compositor-stages-before-draw --virtual-time-budget=10000 `
            --print-to-pdf="$docs\$f.pdf" ("file:///" + ($docs -replace '\\','/') + "/$f.html")
}
```

Chrome does not support CSS margin boxes, so the PDFs have no running header or footer and
no page numbers. Section numbering and the contents page carry navigation instead.
