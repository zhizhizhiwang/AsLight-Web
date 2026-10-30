// Runtime binding types are generated from Wrangler; application secrets are
// deliberately absent from wrangler.jsonc and public configuration.
export type Bindings = Env & { BETTER_AUTH_SECRET: string };
