// Runtime binding types are generated from Wrangler; application secrets are
// deliberately absent from wrangler.jsonc and public configuration.
export type Bindings = Env & {
  BETTER_AUTH_SECRET: string;
  B2_KEY_ID?: string;
  B2_APPLICATION_KEY?: string;
  B2_BUCKET_ID?: string;
  B2_BUCKET_NAME?: string;
  B2_S3_ENDPOINT?: string;
  B2_MONITOR_KEY_ID?: string;
  B2_MONITOR_APPLICATION_KEY?: string;
};
