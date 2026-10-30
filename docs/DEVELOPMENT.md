# 开发与验证

## 工具链

Node.js 24、npm、TypeScript strict。项目锁定 package-lock.json；安装现有版本用 npm ci，增删依赖同步修改 package.json 和锁文件。不要凭旧教程替换依赖主版本。

当前固定 TypeScript 6.0.3，边界检查使用其稳定编译器 API；TypeScript 7 的原生编译器 API 不兼容，升级需同时迁移脚本。Cloudflare 开发工具的传递依赖 undici 暂时覆盖为同主版本的 7.30.1，用于修复 npm audit 报告的漏洞；更新工具链时复核并移除不再需要的覆盖，不执行未经评估的 audit fix --force。

## 命令

| 命令                          | 内容                                                    |
| ----------------------------- | ------------------------------------------------------- |
| npm run dev                   | 同时启动 React 和本地 Worker，默认 5173，端口占用时报错 |
| npm run typecheck             | 分别检查浏览器、Worker、工具与测试类型                  |
| npm run check:boundaries      | 检查 client/server/shared 的运行时导入边界              |
| npm test                      | Node 原生测试，覆盖任务图和 API 合约                    |
| npm run format / format:check | 写入／检查统一格式                                      |
| npm run build                 | 构建静态资源与 Worker                                   |
| npm run check:bundle          | 检查构建后的内部体积预算                                |
| npm run check                 | 顺序运行全部静态检查、测试和构建                        |
| npm run preview               | 在本地 Worker 预览已构建结果，默认 4173                 |

Windows 若 npm.ps1 被限制，用 npm.cmd；不要为此修改全局 PowerShell 执行策略。

## 验证层次

1. 领域测试覆盖有效前置、all/any、未知依赖、重复 ID 和循环，不测试文案快照。
2. Hono 内存测试覆盖 JSON 合约、未知 API、不可写演示数据；它不证明 Cloudflare 运行时行为。
3. 运行 dev/preview，验证默认进入流程图，三个并列子页能直接访问与刷新，以及已知 API 和未知 API 的 JSON 404。
4. 浏览器检查左侧导航、主支线筛选、地图节点点击、列表同步、任务详情关闭／返回／焦点恢复、手机布局和错误加载；后端接口验证不能替代浏览器检查。
5. 接入 D1、认证和上传后，补充真实适配层集成测试和越权／并发测试。

GitHub Actions 运行 npm ci 和 npm run check。包含本地 Worker/D1 集成测试，不含自动发布、远程迁移或真实云资源测试。

## 实现习惯

路由层做输入验证、会话和角色检查；业务规则放 server/domain；数据库模块集中在 server/db。错误返回稳定 code 与安全中文 message，不把堆栈、SQL 或令牌发给客户端。

只共享必要数据契约。当前边界脚本采用 TypeScript 语法树检查静态／动态导入；新增别名也必须让边界检查识别。类型检查不是运行时验证。

不在浏览器存储中保存权威进度。地图缩放、视图偏好可留本地，但不能代替账号数据。任何示例数据都需保留 demo 标识。

## Git 流程

首次推送建立 main。后续功能通常在短分支上完成，按用户要求决定 PR／合并／推送。只暂存任务相关文件，不强推。初始化不会额外创建 Issue、通知他人或部署网站。

变更完成时说明：实现内容、验证证据、真实外部服务是否接入、剩余边界。更新 ROADMAP，规则调整同步 DOMAIN/AUTH/ARCHITECTURE。

## 无短信账号开发

先运行 setup:local，再用 auth:admin bootstrap --local 生成管理员凭证。成员从网页后台创建，激活、重设及改别称都无需邮件或短信。旧 auth:invite／auth:local-mail 命令已移除。

cf:typegen 从 Wrangler 生成被忽略的运行时类型，check 会先生成；CI 无需真实 secret 或 Cloudflare 登录。test:integration 在 build 后使用真实 workerd、持久临时 D1 执行迁移和身份／越权／并发测试，结束清理自己的临时目录。check 已包含这一步。

APP_ORIGIN 默认 http://127.0.0.1:5173；使用 localhost 或 4173 时在 .dev.vars 覆盖并重启，不使用通配来源。测试密钥独立随机生成。Miniflare 5 使用官方 V4 配置转换入口及显式模块列表。

Drizzle 生成父表重建时必须检查 D1 外键行为，不能照搬 PRAGMA foreign_keys=OFF 或导致级联删除；0002 已改为 D1 安全的子表保留与恢复，并测试旧进度不丢失。新 schema 用 db:generate，自定义迁移维护 journal/snapshot，不修改已执行迁移。

Drizzle Kit 的 @esbuild-kit/core-utils 的 esbuild 覆盖为 0.25.12，修复旧开发服务器跨来源读取漏洞；升级后重新评估覆盖。

## 线下流程验证

迁移到 0004 后，成员从任务详情开始学习并申请线下考核；管理员在 /admin → 线下考核与奖励选择成员和任务。奖励说明先按真实需求配置，再登记考核；没有奖励也可通过。退回后以成员账号查看反馈并重新申请，通过后验证下一任务已解锁，即使奖励尚未领取。领取只在实际线下交付后由管理员登记。

tests/integration/learning.test.mjs 使用独立临时数据库与随机测试凭证，真实走激活和登录 API，验证成员隔离、越权、过期版本、重复／冲突重试、并发审核与领取、旧历史保留、奖励快照、无奖励通过、失败回滚和重启持久化。不会向现有开发库或云端插入测试进度。浏览器测试数据必须单独标记并在验证后清理，不操作真实成员进度。
