import { AwsClient } from 'aws4fetch';
import { z } from 'zod';
import type { Bindings } from './bindings.ts';
import { AccessError } from './access.ts';

export function b2Config(env: Bindings) {
  const endpoint = /^https:\/\/s3\.([a-z0-9-]+)\.backblazeb2\.com$/.exec(env.B2_S3_ENDPOINT ?? '');
  if (
    !endpoint?.[1] ||
    !env.B2_KEY_ID ||
    !env.B2_APPLICATION_KEY ||
    !env.B2_BUCKET_ID ||
    !env.B2_BUCKET_NAME ||
    !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(env.B2_BUCKET_NAME)
  )
    throw new AccessError('STORAGE_UNAVAILABLE', '视频服务尚未配置完成，请使用线下考核。', 503);
  return {
    endpoint: endpoint[0],
    region: endpoint[1],
    bucket: env.B2_BUCKET_NAME,
    bucketId: env.B2_BUCKET_ID,
    keyId: env.B2_KEY_ID,
    key: env.B2_APPLICATION_KEY,
  };
}
export function b2Enabled(env: Bindings) {
  try {
    b2Config(env);
    return true;
  } catch {
    return false;
  }
}
export async function signedObject(
  env: Bindings,
  key: string,
  method: 'PUT' | 'GET' | 'HEAD',
  options: { version?: string; headers?: Record<string, string> } = {},
) {
  const config = b2Config(env);
  const url = new URL(
    `${config.endpoint}/${config.bucket}/${key.split('/').map(encodeURIComponent).join('/')}`,
  );
  url.searchParams.set('X-Amz-Expires', '300');
  if (options.version) url.searchParams.set('versionId', options.version);
  const aws = new AwsClient({
    accessKeyId: config.keyId,
    secretAccessKey: config.key,
    service: 's3',
    region: config.region,
    retries: 0,
  });
  return aws.sign(url.toString(), {
    method,
    ...(options.headers ? { headers: options.headers } : {}),
    aws: { signQuery: true, allHeaders: true },
  });
}
const authorizationSchema = z.object({
  authorizationToken: z.string(),
  apiInfo: z.object({
    storageApi: z.object({
      apiUrl: z.url(),
      allowed: z.object({ namePrefix: z.string().nullable() }).optional(),
    }),
  }),
});
const versionsSchema = z.object({
  files: z.array(z.object({ fileId: z.string(), fileName: z.string() })),
  nextFileName: z.string().nullable(),
  nextFileId: z.string().nullable(),
});

// Native API avoids XML and deletes explicit versions, including hide markers.
// Bounded batches resume safely on the next scheduled run.
export async function nativeB2(env: Bindings, fetcher: typeof fetch = fetch, monitor = false) {
  const config = b2Config(env);
  const res = await fetcher('https://api.backblazeb2.com/b2api/v4/b2_authorize_account', {
    headers: {
      Authorization: `Basic ${btoa(`${monitor && env.B2_MONITOR_KEY_ID ? env.B2_MONITOR_KEY_ID : config.keyId}:${monitor && env.B2_MONITOR_APPLICATION_KEY ? env.B2_MONITOR_APPLICATION_KEY : config.key}`)}`,
    },
    redirect: 'manual',
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error('B2 authorization failed.');
  const auth = authorizationSchema.parse(await res.json());
  const apiUrl = new URL(auth.apiInfo.storageApi.apiUrl);
  if (apiUrl.protocol !== 'https:' || !apiUrl.hostname.endsWith('.backblazeb2.com'))
    throw new Error('Invalid B2 API origin.');
  const call = (name: string, body: unknown) =>
    fetcher(`${apiUrl.origin}/b2api/v4/${name}`, {
      method: 'POST',
      headers: { Authorization: auth.authorizationToken, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      redirect: 'manual',
      signal: AbortSignal.timeout(10000),
    });
  return {
    call,
    prefix: auth.apiInfo.storageApi.allowed?.namePrefix ?? null,
    scopeKnown: !!auth.apiInfo.storageApi.allowed,
  };
}
export async function purgeObject(env: Bindings, key: string, fetcher: typeof fetch = fetch) {
  const config = b2Config(env);
  const { call } = await nativeB2(env, fetcher);
  for (let batch = 0; batch < 2; batch++) {
    const list = await call('b2_list_file_versions', {
      bucketId: config.bucketId,
      prefix: key,
      maxFileCount: 10,
    });
    if (!list.ok) throw new Error('B2 version listing failed.');
    const page = versionsSchema.parse(await list.json());
    const exact = page.files.filter((f) => f.fileName === key);
    if (!exact.length) return true;
    for (const file of exact) {
      const deleted = await call('b2_delete_file_version', { fileName: key, fileId: file.fileId });
      if (!deleted.ok) throw new Error('B2 version deletion failed.');
      await deleted.body?.cancel();
    }
  }
  return false;
}
