# Release plan for v0.3

This document describes what goes into the next release, who owns each part, and the open questions. Read the *risks* section before the planning meeting on Thursday.

## Goals

- Ship the new import flow for **CSV and Excel** files
- Reduce the cold start time below 500 ms
- Fix the three crash reports from the last two weeks

## Status

| Area | Owner | Status | Due |
|:-----|:------|:------:|----:|
| Import flow | Anna | In review | Dec 4 |
| Cold start | Joris | In progress | Dec 9 |
| Crash fixes | Sam | Done | Nov 28 |

## Tasks

- [x] Write the import spec
- [x] Agree on the file size limit
- [ ] Add progress feedback for large files
- [ ] Update the onboarding docs

## Technical notes

The importer reads the file in chunks, so memory stays flat for large files:

```ts
for await (const chunk of readChunks(file, 64 * 1024)) {
  parser.push(chunk)
}
```

> The 64 KB chunk size gave the best result in the benchmark. Larger chunks did not help.

```mermaid
graph LR
  Upload --> Parse --> Validate --> Store
```

<details>
<summary>Benchmark details</summary>

Measured on a 2024 laptop, mean of 10 runs.

</details>

## Risks

1. The Excel parser is large. Load it only when the user picks an Excel file.
2. Some CSV files use `;` as the separator. Detect it from the first line.

---

Questions go to the #release channel.
