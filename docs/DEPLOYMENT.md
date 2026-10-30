# 部署、数据和体积预算

状态：已创建开发 D1 aslight-dev 并绑定，本地已迁移；没有 R2、生产密钥或线上部署。首次 GitHub 上传只托管源代码并运行 CI。

## 环境

- 本地：Vite + Cloudflare 插件使用本地 Worker；本地 D1 与无短信账号，无需登录 Cloudflare，先执行 setup:local。
- 测试：将来使用独立 Worker 名、D1 和 R2；不得共用生产数据库、视频或账号密钥。
- 正式：独立域名和资源；通过真实网络和登录渠道验收后发布。

当前 wrangler.jsonc 的 DB 是真实创建的开发库 aslight-dev，不用于生产。R2 尚未配置；迁移位于 migrations。默认 HTTP 回环来源只能用于本地；公网认证要求精确 HTTPS 来源与独立密钥。

compatibility_date 固定为当前安装运行时支持的 2026-10-19，不随电脑日期自动变化；更新日期或工具链必须重新跑本地 Worker 验证。

接入 staging/production 时应显式定义各自配置和部署脚本；Cloudflare 非继承绑定需要逐环境核对。CI 凭据最小权限。当前没有自动部署工作流。

## 数据边界

D1 保存结构化数据；R2 保存图片和视频；GitHub 保存代码、锁文件、迁移、文档。视频、密钥、数据库导出和真实用户资料均不入库。

以一个数据库作为主数据源。KV 如后续引入仅作合适的缓存，不作为奖励、幂等和权限的唯一权威来源。数据库备份与代码版本独立；上线前定义导出频率、保留期并演练恢复。

## 上传契约（待实现）

服务端创建上传意图并分配带归属的对象 key → 短时授权直传 → 服务端核实对象、大小、格式和所有者 → 提交引用内部 media_id。断点／分片上传在需要时添加。

视频默认私有，授权访问时间受限。上传名、Content-Type 和用户报告的大小不可信。限制单文件与每人配额，清理未关联对象；删除／保留期限在开放上传前告知成员。R2 不自动转码，真实手机视频格式需要播放验证。

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
- [R2](https://developers.cloudflare.com/r2/)
- [China Network](https://developers.cloudflare.com/china-network/)

限额、费用、供应商资格随时间变化；此文不固定报价或承诺永久可用性。

## 无外部消息服务的账号配置

只需 APP_ORIGIN（精确同源地址）和 BETTER_AUTH_SECRET（至少 32 字符的独立随机服务端密钥）。不需要邮件域名、Resend、短信签名或验证码模板。遗留 MAIL_MODE／RESEND_API_KEY 配置不再使用；不要在聊天中提供任何密钥。

新环境先执行迁移，再由受控运维命令 bootstrap 管理员，所有者自行激活。开发与生产仍必须使用独立数据库和 secret。CLI 的 --remote 不等于生产环境：默认配置绑定 aslight-dev，远程操作前确认数据库与来源参数。

0002 重建用户表但保留账号、密码记录和进度，旧会话会退出，旧成员需管理员重新发放激活凭证。上线或有真实数据时，先备份并在隔离环境演练迁移；不改动已执行的 0000/0001。

激活／恢复文件和数据库备份都属于私密运维资料，不进 Git。命令仅显示文件路径，不自动发送给任何人。详细命令见 [AUTH](AUTH.md)。

本地构建会复制 .dev.vars 到被忽略的 Worker 目录供 preview 使用，不在 dist/client。不要把整个 dist 当作公开文件上传。
