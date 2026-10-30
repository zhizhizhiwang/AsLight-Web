# 部署、数据和体积预算

状态：2026-10-31 已部署 [aslighters.org](https://aslighters.org)，Worker 为 aslight-production，使用独立 D1 aslight-production、正式认证密钥和 B2 私有桶。开发配置及 aslight-dev 保留；GitHub Actions 仍只检查、不发布。

## 环境

- 本地：Vite + Cloudflare 插件使用本地 Worker；本地 D1 与无短信账号，无需登录 Cloudflare，先执行 setup:local。
- 测试：将来使用独立 Worker 名、D1 和 B2 私有桶；不得共用生产数据库、视频或账号密钥。
- 正式：production 环境，精确来源 `https://aslighters.org`，Custom Domain 自动管理 DNS 与证书，关闭 workers.dev 与预览地址。

当前 wrangler.jsonc 的 DB 是真实创建的开发库 aslight-dev，不用于生产。B2 凭据已作为正式 Worker secret 配置；迁移位于 migrations。默认 HTTP 回环来源只能用于本地；公网认证要求精确 HTTPS 来源与独立密钥。

compatibility_date 固定为当前安装运行时支持的 2026-10-19，不随电脑日期自动变化；更新日期或工具链必须重新跑本地 Worker 验证。

production 已显式配置独立 DB、APP_ORIGIN、域名和日志／追踪；staging 尚未建立。Cloudflare 非继承绑定需要逐环境核对。CI 凭据最小权限，当前没有自动部署工作流。

## 数据边界

D1 保存结构化数据；B2 私有桶保存成员视频；GitHub 保存代码、公开课程图片、锁文件、迁移、文档。公开图片放入 `public/course-assets/`，Vite 构建后由 Workers Static Assets 提供。视频、密钥、数据库导出和真实用户资料均不入库。

以一个数据库作为主数据源。KV 如后续引入仅作合适的缓存，不作为奖励、幂等和权限的唯一权威来源。数据库备份与代码版本独立；上线前定义导出频率、保留期并演练恢复。

## 视频上传契约

服务端创建上传意图并分配带归属的对象 key → 短时授权直传 → 服务端核实对象、大小、格式和所有者 → 提交引用内部 videoId。断点／分片上传在需要时添加。配置步骤与当前边界见 [VIDEOS](VIDEOS.md)。

视频默认私有，授权访问时间受限。上传名、Content-Type 和用户报告的大小不可信。限制单文件与每人配额，清理未关联对象；删除／保留期限在开放上传前告知成员。当前 B2 方案不自动转码，真实手机视频格式需要播放验证。

## 构建预算

以下是项目内部的保守预算，不是 Cloudflare 平台限额。由 scripts/check-bundle.mjs 检查；调整需要解释原因并同步文档。

| 项目                                  | 初始预算 |
| ------------------------------------- | -------- |
| Worker JavaScript 合计 gzip           | 1 MiB    |
| 前端 JavaScript 合计 gzip，含懒加载块 | 1.5 MiB  |
| 单个前端静态文件                      | 2 MiB    |
| 前端静态文件数量                      | 1000     |

脚本统计目录内 JS 文件各自 gzip 后的合计，作为回归信号，不等价于平台的最终部署计量。正式发布仍需检查平台的代码大小、资源数、单文件限制、CPU 时间和兼容日期。

不把 node_modules、视频或大型示范资源复制到静态产物。地图按需加载，后续管理后台也按需加载。不要仅通过放宽预算隐藏依赖膨胀。

## 发布前核对

完成本地检查、staging 端到端测试、账号渠道开通和备份恢复验证。确认生产资源及凭据，执行可回滚的数据库迁移再发布应用；破坏性 schema 变更必须有专门迁移方案，代码回滚不等于数据库回滚。

面向大陆成员，需要实测移动、联通、电信下的登录、加载和视频上传／播放。普通全球 Cloudflare 服务不等于 China Network。若访问体验不达标再调整托管位置，迁移前验证数据导出和账号连续性。

## 官方参考

- [Workers 限额](https://developers.cloudflare.com/workers/platform/limits/)
- [Workers 静态资源](https://developers.cloudflare.com/workers/static-assets/)
- [SPA 路由](https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/)
- [D1](https://developers.cloudflare.com/d1/)
- [B2 私有内容经 Workers 提供](https://www.backblaze.com/docs/cloud-storage-deliver-private-backblaze-b2-content-through-cloudflare-cdn)
- [China Network](https://developers.cloudflare.com/china-network/)

限额、费用、供应商资格随时间变化；此文不固定报价或承诺永久可用性。

## 无外部消息服务的账号配置

只需 APP_ORIGIN（精确同源地址）和 BETTER_AUTH_SECRET（至少 32 字符的独立随机服务端密钥）。不需要邮件域名、Resend、短信签名或验证码模板。遗留 MAIL_MODE／RESEND_API_KEY 配置不再使用；不要在聊天中提供任何密钥。

新环境先执行迁移，再由受控运维命令 bootstrap 管理员，所有者自行激活。开发与生产仍必须使用独立数据库和 secret。CLI 的 --remote 不等于生产环境：默认配置绑定 aslight-dev，远程操作前确认数据库与来源参数。

0002 重建用户表但保留账号、密码记录和进度，旧会话会退出，旧成员需管理员重新发放激活凭证。上线或有真实数据时，先备份并在隔离环境演练迁移；不改动已执行的 0000/0001。

激活／恢复文件和数据库备份都属于私密运维资料，不进 Git。命令仅显示文件路径，不自动发送给任何人。详细命令见 [AUTH](AUTH.md)。

本地构建会复制 .dev.vars 到被忽略的 Worker 目录供 preview 使用，不在 dist/client。不要把整个 dist 当作公开文件上传。

## 正式站点操作

- `npm run db:migrate:production`：显式操作正式 D1，不触碰开发库；部署不自动执行迁移。
- `npm run build:production`：以 production 环境构建并检查体积。
- `npm run deploy:production`：先跑完整本地检查，再构建 production 并发布。默认保留已有远程 secrets；首次秘密配置通过被忽略的 JSON 文件及 Wrangler `--secrets-file` 上传，不在参数或日志中输出值。
- `.dev.vars` 为本地配置；`.dev.vars.production` 保存独立正式认证密钥及 B2 配置，仅供本机生产构建／预览，已被 Git 忽略。修改本地秘密不会自动修改线上，必须显式更新正式 secret。
- 首次管理员创建属于单独的权限变更，需站点所有者授权后，使用 `npm run auth:admin -- bootstrap --remote --origin=https://aslighters.org --env=production`。凭证只写 `.cache/admin-access/`，不在聊天、日志或仓库中公开；由所有者自行选择登录别称和密码激活。恢复同样使用受控运维工具。

本次正式 D1 已执行 0000–0009 共十个迁移，外键检查通过；没有复制本地账号、进度或测试记录。首次部署时线上课程为一章四项占位任务，之后的课程内容以线上保存版本为准。B2 已核实私有桶，增加仅允许正式站点 PUT 的 CORS 规则；已有规则保留。真实存储检查覆盖签名 PUT、HEAD、固定版本 Range（206）、匿名拒绝及版本永久删除，临时测试文件已清理。公网 HTTPS、静态资源、所有页面直达、匿名课程、会话查询、管理接口 401、来源校验 403 和未知 API 404 均通过。首个管理员已按站点所有者明确授权初始化，交付时凭证写入本地被忽略目录并核验了摘要、用途、有效期和未消费状态；开发者未设置密码。2026-10-31 复核正式库确认该管理员已激活。用户随后反馈已跑通一次线上流程；具体分支／手机设备覆盖及多运营商体验仍需补充记录。
