# Step cards

A card is one file here. It draws the current question's state for its step, in the
conversation, through the kit:

- `kit/view.ts` builds the `CardView` a card reads: the documents, `derived`, the text
  rules' index, the current question, its engine state and its proof.
- `kit/Shell.tsx` is the frame: a title, up to five labelled points, a footer, at most two
  actions, the host's height limit.
- `kit/FieldName.tsx` shows an id from a field (`I19`, `S26`, `a_003`, `pe_060`, `q_001`)
  as what it names. `rules/Prose.tsx` shows any text an agent wrote. Never put a field's
  or a document's text on a card any other way.
- `kit/words.ts` turns stored values into words: a tier, a shortfall, a state, the next
  step, "N more in the case file".

## Adding a card

1. Write `<Step>Card.tsx`, taking `CardProps`, returning a `Shell`.
2. Replace its `StubCard` entry in `registry.ts`.
3. Test it in `cards.test.tsx` over the committed fixtures in `test-views.ts`.

## A card is finished when

- `make mcp-viewer-sweep` passes: it draws every card for every question of every
  committed end state;
- `make viewer PROJECT=<folder>` shows it, and the PR carries a screenshot in light and in
  dark;
- the id check (`leftoverIds`) passes on its rendered text in its tests;
- no retired row (`superseded_by` set) shows on it: plant one in its test.
