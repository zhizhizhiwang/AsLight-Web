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
3. 运行 dev/preview，验证首页、已知 API、未知 API 的 JSON 404 和 SPA 路由刷新。
4. 浏览器检查地图节点点击、列表同步、手机布局、键盘焦点、错误加载；后端接口验证不能替代浏览器检查。
5. 接入 D1、认证和上传后，补充真实适配层集成测试和越权／并发测试。

GitHub Actions 运行 npm ci 和 npm run check。当前不含自动发布和真实云资源测试。

## 实现习惯

路由层做输入验证、会话和角色检查；业务规则放 server/domain；数据库模块后续集中管理。错误返回稳定 code 与安全中文 message，不把堆栈、SQL 或令牌发给客户端。

只共享必要数据契约。当前边界脚本采用 TypeScript 语法树检查静态／动态导入；新增别名也必须让边界检查识别。类型检查不是运行时验证。

不在浏览器存储中保存权威进度。地图缩放、视图偏好可留本地，但不能代替账号数据。任何示例数据都需保留 demo 标识。

## Git 流程

首次推送建立 main。后续功能通常在短分支上完成，按用户要求决定 PR／合并／推送。只暂存任务相关文件，不强推。初始化不会额外创建 Issue、通知他人或部署网站。

变更完成时说明：实现内容、验证证据、真实外部服务是否接入、剩余边界。更新 ROADMAP，规则调整同步 DOMAIN/AUTH/ARCHITECTURE。
