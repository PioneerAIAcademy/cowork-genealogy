const r = await fetch("https://api.familysearch.org/platform/places/11", {
  headers: { Accept: "application/json" },
});
const data = await r.json();
console.log(JSON.stringify(data, null, 2));
