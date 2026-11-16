# hartley-census-after-burial

The tree's William Hartley (I1) was buried in Halifax on 16 February 1870. Two records give
that burial, the parish register and the cemetery's interment register, and both are linked
to him at `confident`. A name search has returned an 1881 census entry for a William Hartley
of the same age, birthplace, trade and town.

## Starting state

Tree (`tree.gedcomx.json`):

- **I1 William Hartley**, born about 1845 in Halifax; a woolsorter there in 1861 (S1);
  buried 16 February 1870 in Halifax (S3, S4)
- **I2 Joseph Hartley**, his father, joined to him by **RT1** (ParentChild)

Research (`research.json`):

- `src_001` / `S5`: the 1881 census, Halifax. `a_001`-`a_004` are the lodger William Hartley,
  36, woolsorter, born Halifax. `a_005` is the head of that household, Samuel Greenwood. None
  is linked.
- `src_002` / `S1`: the 1861 census (`a_010`-`a_013`), linked to I1 at `confident`.
- `src_003` / `S3`: the parish burial register (`a_020`, `a_021`), which gives his age as 25
  and names him son of Joseph Hartley of Gibbet Street; linked to I1 at `confident`.
- `src_004` / `S4`: the cemetery interment register (`a_030`, `a_031`), which places him in
  the grave of Joseph Hartley; linked to I1 at `confident`.

## What a correct run does

Writes no link. `same_person` scores the pairing high and lists, in `warningsIfLinked`, that
the 1881 entry would put an event more than a year after I1's burial. Two independent records
give that burial, each tying him to his father, and nothing on the census entry ties its
William to I1 beyond name, age, trade and town, so the entry is a different William Hartley.
The reply names the warning and the burial records and says the entry was not linked.
