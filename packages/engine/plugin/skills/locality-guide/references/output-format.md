# Locality Guide Output Format

Use this structure when compiling the final guide. Fill in every
section with specific data from MCP tool results. Omit sections only
when the record type is clearly inapplicable (e.g., international
border-crossing manifests for a locality far from any land border or
port of entry — only border crossings and ports of entry are
geographically bound). Do **not** omit immigration records for an
inland area: declarations of intention, naturalizations, affidavits
filed by relatives, and alien registrations were all generated inland,
far from any port.

```markdown
# Locality Guide: [Place] ([Time Period])

## Jurisdiction overview
- **Formed:** [date] from [parent jurisdictions]
- **County seat / administrative center:** [name]
- **Parent jurisdiction:** [state/province/country]
- **Population during period:** [figures with census years]
- **Economy:** [dominant industries and occupations]
- **Ethnic composition:** [major ethnic/national groups present]
- **Religious denominations:** [churches present in the area]
- **Key historical events:** [wars, disasters, economic changes]

## Boundary changes
- [List any boundary changes during or near the target period]
- [Note which parent jurisdiction held records before formation]
- [If stable, state that boundaries were unchanged]

## Available record types

For each record type below, note the jurisdictional level it is held at
— city/town, county, or state. Do not assume a default level: it varies by
place and era (e.g. town/parish in early New England, county in many states
once civil registration begins), so state the level from the tools/wiki per
SKILL.md's registration-level rule rather than a default. The holding level
is what tells the researcher where to route the search.

### Vital records (civil registration)
- **Start date:** [when civil registration began]
- **What exists:** [births, marriages, deaths — with date ranges]
- **Where held:** [repository and access method]
- **Gaps:** [any missing years or known losses]
- **Pre-registration alternatives:** [church records, other sources]

### Church records
- **Denominations present:** [list with approximate founding dates]
- **Record types:** [baptisms, marriages, burials, confirmations]
- **Where held:** [parish, diocese, FamilySearch microfilm, etc.]
- **Language:** [language of records if not English]

### Census records
- **Federal/national census:** [years available, known gaps]
- **State/provincial census:** [if applicable]
- **Other enumerations:** [tax lists, ecclesiastical counts]
- **Access:** [which are indexed, which are browse-only]

### Probate and court records
- **Types:** [wills, administrations, guardianships, inventories, petitions]
- **Testate or intestate:** [whether the person left a will (testate → look
  for wills) or died without one (intestate → look for administrations) —
  this decides which probate series to search]
- **Date range:** [from formation or earlier if inherited]
- **Where held:** [courthouse, state archives, digitized?]

### Land records
- **Survey system:** [metes and bounds, rectangular survey, other]
- **Land-distribution jurisdiction:** [state-land or federal-land — decides whether grants/patents are held by the state land office or the federal GLO/BLM]
- **Types:** [deeds, grants, patents, mortgages, tax records, bounties, land acts (e.g., the Homestead Act)]
- **Date range:** [earliest available]
- **Where held:** [recorder of deeds, state land office, online?]

### Military records
- **Relevant conflicts:** [wars during or near the period]
- **Record types:** [service, pension, draft, bounty land]
- **Where held:** [NARA, state archives, online databases]

### Cemetery records
- **Major cemeteries:** [names and denominations]
- **Online coverage:** [FindAGrave, BillionGraves, other]
- **Physical records:** [sexton records, burial registers]

### Newspaper records
- **Local papers:** [names and date ranges of publication]
- **Where held:** [digital archives, library microfilm, online]
- **Content value:** [obituaries, marriage notices, legal notices]

### Immigration/emigration records
- **Relevant ports:** [nearest ports of entry]
- **Record types:** [passenger lists, naturalization, border crossing]
- **Where held:** [NARA, online databases]
- **Content note:** Passenger lists (arrival manifests) record every
  person aboard, including infants and young children traveling with
  parents. When researching a family, examine the full manifest for
  all family members — children as young as newborns are listed.

### Tax records
- **Types:** [property tax, poll tax, personal property]
- **Date range:** [earliest available]
- **Where held:** [county, state archives]
- **Substitute value:** [can replace missing census years]

### Other record types
- [School records, institutional records, organizational records,
  occupational records — as applicable to the locality]

## Repository guide

### Online repositories
| Repository | Collections for this place | Access |
|---|---|---|
| FamilySearch | [list with record counts] | Free |
| Ancestry | [list] | Subscription |
| [Others] | [list] | [Access type] |

### Physical repositories
| Repository | Holdings | Access method |
|---|---|---|
| [County courthouse] | [what they hold] | In-person / mail |
| [State archives] | [what they hold] | In-person / online request |
| [Local historical society] | [what they hold] | [hours/contact] |
| [Church archives] | [what they hold] | [contact method] |

## Records NOT online

[Explicitly list record types that exist but are not available in any
online database. This prevents the researcher from assuming these
records do not exist.]

## Known record losses

[Document any known destructions — courthouse fires, floods, wartime
damage, intentional destruction — with dates and what was lost. Note
any substitute sources that partially compensate.]

## Research tips
- [Jurisdiction-specific advice from wiki articles — cite the source page URL
  inline per the SKILL.md rule "Cite the FamilySearch Wiki page, not just its title", e.g.
  "Town clerks recorded vital records from 1639 ([Massachusetts Vital
  Records](https://www.familysearch.org/en/wiki/Massachusetts_Vital_Records))"]
- [Naming conventions or spelling patterns for this area]
- [Alternative sources when primary records are missing]
- [Efficient research sequence for this jurisdiction]
- [Relevant finding aids and research guides to consult]
```

## Digitization level classification

For each record type, classify its accessibility:

| Level | Meaning |
|-------|---------|
| **Indexed + images** | Searchable by name; images viewable online |
| **Browse-only images** | Online but must be browsed without name index |
| **Microfilm** | Available on film at FHL or through interlibrary loan |
| **Physical only** | Must visit or write to the holding repository |
| **Destroyed/lost** | No longer extant; note substitute sources |
