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

## Seeing a card

```
make mcp-viewer-sweep
make viewer PROJECT=releases/mcp-viewer-sweep/projects/<end state>
```

- `make viewer` opens a tab on the `latest` card. Add `?show=<step>` to the URL to draw one
  step's card (`?show=link`), and `&questionId=q_002` to draw it for another question.
- The tab follows the browser's light or dark setting. To check dark, switch the operating
  system's appearance, or in Chrome use DevTools, Rendering, "Emulate CSS media feature
  prefers-color-scheme".
- On Windows, run both targets from Git Bash or WSL: `scripts\windows` has no wrapper for
  them.

## A card is finished when

- `make mcp-viewer-sweep` passes: it draws every card for every question of every
  committed end state;
- `make viewer PROJECT=<folder>` shows it, and the PR carries a screenshot in light and in
  dark;
- the id check (`leftoverIds`) passes on its rendered text in its tests;
- no retired row (`superseded_by` set) shows on it: plant one in its test.
