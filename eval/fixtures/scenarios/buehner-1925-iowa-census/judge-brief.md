# buehner-1925-iowa-census (judge brief)

Tree: I1 John Buehner, born about 1858 in Iowa, last known residence Iowa in 1915.
I2 Caroline Buehner (maiden name Holdiman), born about 1862 in Iowa, is his wife
(R1 Couple).

Plan item pli_001 (1925 Iowa State Census, collection `2224537`): every search
carrying surname Buehner, or the tried spelling variants Buchner/Buhner, returns
`totalMatches: 0`. A wildcard surname search (`Bu*ner`) also returns 0. He is in
fact indexed as "John Boehner" — a transcription none of those variants guesses —
in the 1925 household of Boone County, Iowa, with wife "Caroline," age and county
consistent with the tree. A search dropping `surname` entirely and anchored on
`recordCountry` + the place + Caroline's given name reaches that row.
