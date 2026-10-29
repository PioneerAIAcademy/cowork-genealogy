# Developer commands for small-and-simple. Run from this directory.
#
#   make demo                 transcribe a sample page and print it
#   make demo ARK='<ark>'     transcribe any page (ARK, familysearch.org URL or imageId)
#   make eval                 score transcribe-image against its fixtures
#   make test                 typecheck and offline tests (what CI runs)
#
# demo and eval call FamilySearch and OpenRouter. Credentials: FS_TOKEN and
# OPENROUTER_API_KEY, else the files the engine's login tool writes
# (dev/credentials.ts).

.PHONY: demo eval test

node_modules: package.json package-lock.json
	npm ci
	@touch node_modules

demo: node_modules
	@npm run --silent demo:transcribe-image -- "$(ARK)"

eval: node_modules
	@npm run --silent eval:transcribe-image

test: node_modules
	npm run typecheck
	npm test
