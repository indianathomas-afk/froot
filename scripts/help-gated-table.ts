// The gated-section table, extracted from scripts/verify-help-access.ts by
// SEARCH-1 (2026-09-06) so a second script can assert against the same rows.
//
// WHY IT MOVED RATHER THAN BEING EXPORTED WHERE IT WAS. verify-help-access.ts
// runs its whole suite at module scope and ends with process.exit(). Importing
// GATED from it would have executed that suite and then killed the IMPORTING
// process — verify-search-scope.ts would have exited 0 without running one of
// its own assertions, which is the "green run worth nothing" failure the nav
// parser's own `< 20` guard exists to prevent. This file has no side effects
// and no imports, so both scripts can read it and neither can end the other.
//
// EXTENDING IT: add a row per gated section, exactly as before. Both consumers
// pick it up. verify-help-access.ts asserts the section is hidden on the HELP
// surface; verify-search-scope.ts asserts its vocabulary does not reach a
// GLOBAL search result for the same reader.
//
// `deniedRoles` is roles that CAN see the article but CANNOT see the section —
// stated rather than computed, so a wrong expectation fails instead of quietly
// agreeing with the code.
export const GATED = [
  {
    article: "hr-documents",
    section: "versions-and-fields",
    heading: "Versions, detected fields and audience",
    deniedRoles: ["MANAGER", "STORE", "STAFF"],
    terms: ["audience", "Version", "version", "detected", "ceremony", "pinned"],
    reachableRoutes: ["/hr/documents"],
    allRoutes: 2,
  },
  {
    article: "hr-training",
    section: "authoring",
    heading: "Building and changing a module",
    // The article is hr.training.manage (MANAGE), so STORE and STAFF cannot see
    // it at all and are not part of this test — they are covered by the
    // per-role counts above.
    deniedRoles: ["MANAGER"],
    terms: ["Building", "New Module", "Duplicate", "Duplicat", "clone", "author"],
    reachableRoutes: ["/hr/training", "/hr/training/[id]/preview"],
    allRoutes: 4,
  },
] as const
