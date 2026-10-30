import { z } from 'zod';

export const productionTarget = {
  name: 'aslight-production',
  origin: 'https://aslighters.org',
  database: 'b0b1538d-a98a-483b-9c05-447440457cab',
};
const configSchema = z.object({
  name: z.literal(productionTarget.name),
  targetEnvironment: z.literal('production'),
  vars: z.object({ APP_ORIGIN: z.literal(productionTarget.origin) }),
  d1_databases: z.array(z.object({ binding: z.string(), database_id: z.string() })),
  routes: z.array(z.object({ pattern: z.string(), custom_domain: z.boolean().optional() })),
});
export function assertProductionBuild(input: unknown) {
  const config = configSchema.safeParse(input);
  if (
    !config.success ||
    config.data.d1_databases.filter((b) => b.binding === 'DB').length !== 1 ||
    config.data.d1_databases.find((b) => b.binding === 'DB')?.database_id !==
      productionTarget.database ||
    !config.data.routes.some((r) => r.pattern === 'aslighters.org' && r.custom_domain)
  )
    throw new Error(
      '拒绝发布：构建的 Worker、域名或数据库不是正式环境。请先运行 npm run build:production。',
    );
}
export function assertLocalSecrets(
  local: Record<string, string>,
  production: Record<string, string>,
) {
  for (const name of [
    'B2_BUCKET_ID',
    'B2_BUCKET_NAME',
    'B2_KEY_ID',
    'B2_APPLICATION_KEY',
    'B2_MONITOR_KEY_ID',
    'B2_MONITOR_APPLICATION_KEY',
    'BETTER_AUTH_SECRET',
  ]) {
    if (local[name] && production[name] && local[name] === production[name])
      throw new Error('拒绝启动本地环境：本地与正式环境共用了存储资源或凭据。请配置独立测试资源。');
  }
}
