# Schema template change — for client approval

**Prepared:** 2026-08-24 · WO-4 Step D · **Not applied.** Template diff only.
**Client:** Monika Hicks, LCSW · hicksconsulting.org

## Measured today

| Signal | Current |
|---|---|
| Pages scanned | 266 |
| Pages carrying a `Person` node | **2** |
| `Person` with `sameAs` | **0** |
| `Person` with `hasCredential` | **0** |
| `meta name="author"` | **0** |
| Pages with an `author` property | 229 |

The two existing `Person` nodes look like this:

```json
{"@type":"Person","name":"Monika Hicks, LCSW","jobTitle":"Licensed Clinical Social Worker",
 "url":"https://www.hicksconsulting.org/about/",
 "worksFor":{"@type":"Organization","name":"Hicks Consulting"}}
```

Correct as far as it goes, but with no `@id` and no `sameAs` there is nothing for a
search or answer engine to resolve the person *against*. For YMYL mental-health
content, verifiable practitioner identity is the strongest available signal, and
it is currently absent from 264 of 266 pages.

## Proposed template change

Add to the author entity, emitted identically on every page:

```json
{
  "@type": "Person",
  "@id": "https://www.hicksconsulting.org/about/#monika-hicks",
  "name": "Monika Hicks, LCSW",
  "jobTitle": "Licensed Clinical Social Worker",
  "url": "https://www.hicksconsulting.org/about/",
  "worksFor": { "@id": "https://www.hicksconsulting.org/#organization" },
  "hasCredential": {
    "@type": "EducationalOccupationalCredential",
    "credentialCategory": "license",
    "name": "Licensed Clinical Social Worker (LCSW)",
    "recognizedBy": { "@type": "Organization", "name": "<state licensing board>" }
  },
  "knowsAbout": ["<to be confirmed by client>"],
  "sameAs": [
    "<state licensing board verification URL>",
    "<Psychology Today profile>",
    "<NASW or association listing>",
    "<insurance panel listing>",
    "<LinkedIn>",
    "<Google Business Profile>"
  ]
}
```

Plus `<meta name="author" content="Monika Hicks, LCSW">` and `author` on each page
bound to that `@id`.

## What the client must supply

Every angle-bracket value above. **None of it can be filled in from this side:**

- Licensing board and the public verification URL for the licence
- Which external profiles she wants listed and linked
- Confirmation of `knowsAbout` topics
- Whether insurance panel listings should be public

Inventing any of these would be fabricating a credential. They are left blank
deliberately.

## Impact and risk

**Gain.** Verifiable practitioner identity across 266 pages instead of 2. For
YMYL, this is the difference between anonymous content and attributable expertise.

**Risk.** Low technically — additive JSON-LD, no visible page change, no content
edit, no cadence change. The real consideration is that it makes the practitioner's
professional identity more machine-discoverable, which is a decision for her, not
a technical call.

**Not applied.** This is a template diff awaiting approval. Nothing in this repo has
been changed.
