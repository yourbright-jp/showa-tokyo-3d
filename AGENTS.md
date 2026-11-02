# Project instructions

- Initial scope: the Kabukicho Ichibangai entrance to the former Koma Theatre, targeting approximately1976. Add other Tokyo districts and years as separate scenes.
- Read `README.md`, `docs/PRODUCTION_PLAN.md`, and `docs/ASSET_POLICY.md` before changing scene data.
- Preserve source attribution and record source year separately from reconstruction year. Current PLATEAU/OSM geometry is a modern reference, not evidence of1976 conditions.
- Never invent verified coordinates, dimensions, poster programmes or historical confidence. Keep unresolved values explicit.
- Record coordinate reference systems and conversion steps. Scene interchange uses metres and right-handed Y-up coordinates; preserve georeferencing separately.
- Keep readable sign text stable across frames. Preserve the common camera route and world geometry when iterating on appearance.
- Keep archived originals, generated reference art and the reconstructed scene distinguishable. Do not publish third-party source images or meshes without recording their applicable redistribution terms.
- Add source/provenance metadata before adding distributable assets. Do not store private links, credentials or account identifiers in the public repository.
- Use Git LFS for the binary production formats listed in `.gitattributes`. Keep upstream bulk downloads in ignored `data/raw/` and render outputs in ignored `renders/`.
- Before reporting a milestone, validate changed scene/metadata files and inspect representative views from the route. Report uncertainty and limitations plainly.
