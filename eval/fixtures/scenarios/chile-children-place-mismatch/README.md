# chile-children-place-mismatch

Benjamín Silva Díaz and Clara González Pimienta, a couple who lived in Nancagua, Colchagua, Chile. The research question is to enumerate all children born to this couple in Chile civil registration, 1890–1910.

**Place-mismatch quirk.** Most of the couple's children are indexed under Nancagua. One child, Zulema de Jesús Silva González (born 12 Nov 1897), is indexed under Pichilemu, Petorca, Aconcagua — a different jurisdiction entirely. A place-anchored search across Nancagua or even all of Colchagua never reaches her. FamilySearch collection 1630787 (Chile, Civil Registration, 1880-1933) covers all of Chile, so a place-free search over the full collection finds all children.

**Expected outcome.** The agent runs at least one search without a place parameter (anchored on `recordCountry: Chile` and `fatherSurname: Silva` or similar parents-and-country anchor), finds Zulema (ark:/61903/1:1:Q2S2-PCBW) in addition to the place-anchored hits, and logs her.
