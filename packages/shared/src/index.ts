// Cross-app type contracts. Schemas are generated from Pydantic models in
// apps/api/src/schemas/ via apps/api/scripts/generate_shared_schemas.py once that
// pipeline lands (Wave 2+). Until then, this package exists only to reserve the
// import path — apps should import directly from their local clients.
//
// Resist hand-writing schemas here: any drift between hand-written types and
// the generated output will be silent and hard to debug.

export {};
