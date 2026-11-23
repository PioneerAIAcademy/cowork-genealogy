# Judge brief: tyler-fluvanna-census

A one-question project on the head of a Black household in Cunningham District,
Fluvanna County, Virginia. The question (`q_001`) asks what given name the enumerator
wrote for her on the 1900 US census page. The tree's subject, I1, carries the given name
Anthony. Nothing in the project supports that name except a machine transcription.

What the project holds:

- **The 1900 census entry** (`src_001`, record `ark:/61903/1:1:MMF1-WWF`, image
  `ark:/61903/3:1:S3HT-DTXQ-WTP`). The FamilySearch index gives her surname, Tyler,
  and no given name: female, widowed, born April 1853 in Virginia. Her assertions are
  linked to I1.
- **One earlier machine transcription of that page** (`log_002`). It read line 23 as
  "Tyler Anthony". No person has read the image, and nothing else gives that name.
- **The 1880 census entry** (`log_003`, record `ark:/61903/1:1:MC5S-GVQ`). The index
  gives the head of household as "Armtogne Tyler", a Mulatto laundress born about
  1840. No source entry was made for it.
- **A 1923 Virginia death certificate** (`src_002`, record `ark:/61903/1:1:QVR7-5LJJ`).
  The index gives the deceased as "Ann Tone Lightfoot", given name "Ann Tone", Black,
  died 29 October 1923 in Cunningham, Fluvanna County, father Job Lightfoot. Its
  assertions are extracted and linked to no one.
- **The researcher's upload of page 36 of the 1880 census**
  (`uploads/1880-census-cunningham-p36.png`). Its bytes are a placeholder. What the page
  says is whatever `image_transcribe` returns for it in the test.

A transcription is read with `image_transcribe`, which stages the page and returns a
`staged` ref and a short excerpt. The full text is then read with `sidecar_read` on
that ref.
