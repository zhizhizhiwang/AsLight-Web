# Aslight

以任务图谱组织主线与支线的 Wota 艺学习网站。面向个人／社团，从基础练习、成果提交到管理员审核和奖励登记。

## 当前状态

已接入 React + Vite + Hono、FTB 式任务面板，以及 Better Auth + Drizzle/D1 的账号和个人进度。管理员创建待激活成员，私下交付专属凭证；成员自行设置 11 位数字登录别称、昵称和密码。手机号仅作别称，不验证号码归属，不发送短信或邮件。

**课程仍为占位内容。** 已支持开始学习、申请线下考核、管理员通过／退回、重新申请及线下奖励领取登记。视频提交已接入 B2 私有桶直传、管理员鉴权播放、删除及定时清理；已配置真实 B2 并完成存储接口检查，账号注销尚未开放。正式站点为 [aslighters.org](https://aslighters.org)，使用独立 aslight-production 数据库与正式密钥；开发 D1 aslight-dev 保留。首个管理员已按站点所有者授权初始化，并已确认激活；开发者未代设密码。用户已反馈跑通一次线上流程；后续补充分支与设备覆盖记录。

教程与考核文案由用户提供；当前关卡使用“主线1、主线2、主线3、支线1”等占位名称，开发工作只负责系统功能与内容承载。

已支持 `/content` 章节设计：管理员单独授予已激活账号编辑权限。中央画布支持放置任务、拖动与多选移动、复制、前置连线及装饰定位；选中任务后打开图文与属性面板，坐标输入用于精确调整，并保留桌面／手机只读预览。属性说明主支线与前置的区别，已有学习记录的任务锁定前置与考核修改。保存即整体生效，其他人刷新查看，无发布流程；并发保存防覆盖，原有学习／审核／奖励保留。图片改为填写 HTTPS 链接或 `/course-assets/...` 路径；仓库图片放在 `public/course-assets/` 随 Worker 静态资源部署，不提供网页上传。桌面画布操作与 390 × 844 浏览器视口检查已完成，尚未验证真机触摸手势，具体范围见 [ROADMAP](docs/ROADMAP.md)。

## 页面结构

成员列表支持授予／撤销其他已激活账号的管理员权限，须确认自己的当前密码、填写原因和核对目标；不能修改自己，始终保留一位有效管理员。角色变更会退出目标的旧会话、撤销未使用凭证，保留进度及独立编辑权限。首次管理员初始化和管理员密码恢复仍走受控运维工具。

任务属性已增加删除入口：新建未保存任务可直接移除；已保存任务须无学习／考核／奖励记录且无其他任务引用，确认后随保存删除，保存前可以撤销。有记录的任务继续使用归档，服务端会重新检查并保留删除审计。

默认进入 `/flow` 流程图；`/tasks` 为任务列表；`/overview` 为主页面，提供当前章节和任务结构概览。三页共用左侧竖直导航，没有独立的宣传首页。手机也保留左侧导航，缩窄为图标与文字标签，可展开章节列表。章节按数据库顺序排列，章节列表独立滚动；标题、文字图标和顺序不再固定在页面中。

三个子页通过 `?chapter=章节ID` 沿用当前章节，支持刷新与浏览器前进／后退；空章节和失效链接会明确提示。详情中的跨章节前置显示来源章节并可跳转，服务端使用完整课程判断解锁。流程图与列表共用任务类型筛选，`?kind=main` / `?kind=side` 可直接访问。点击任务打开详情弹窗，`?quest=任务ID` 可刷新恢复；Escape 或关闭按钮返回。流程图筛选支线时会淡化保留必要前置节点，避免关系断开。章节支持图片图标、背景和独立画布装饰；任务图片在图谱、列表和详情共用，详情可按顺序展示标题、段落、列表、图片及独立考核内容。缺图时保留文字提示或原标记，装饰不参与解锁和进度。手机长详情使用全屏弹层，关闭入口随滚动保留。手机流程图默认聚焦当前类型的首个任务，支持拖动和双指缩放；任务列表可一次查看全部任务。登录后显示自己的学习状态；未登录时只浏览，不返回个人进度。左下角进入 `/account`；管理员登录后可进入 `/admin` 成员管理。

## 本地启动

使用 Node.js 24 和 npm。首次克隆后：

```sh
npm ci
npm run setup:local
npm run dev
```

打开终端输出的本地地址，默认 `http://127.0.0.1:5173`。setup:local 自动生成被忽略的随机本地密钥并执行本地 D1 迁移；不连接远程库，无需 Cloudflare 登录。Windows PowerShell 若限制 npm.ps1，可使用 `npm.cmd`。

```sh
npm run check        # 类型生成、格式、类型、边界、测试、构建、体积、Worker/D1 集成
npm run format       # 统一格式
npm run build        # 生产构建
npm run preview      # 预览构建产物；认证的 APP_ORIGIN 必须与预览地址一致
```

`npm run deploy` 会先执行全部检查再尝试部署，只有明确要发布且已配置正确的 Cloudflare 账号／资源时使用。正式站点使用 `npm run deploy:production`，不会自动执行生产迁移；先运行 `npm run db:migrate:production` 应用已审核迁移。

## 目录

```text
src/client/          React 界面、浏览器端 API 客户端
src/server/          Hono 路由、示例数据、服务端业务规则
src/shared/          无环境依赖的数据类型
tests/               Node 原生测试：领域规则和 API 合约
scripts/             代码边界和构建产物体积检查
migrations/          Drizzle schema 与占位课程 SQL 迁移
docs/                产品规则、架构、账号、开发、部署、路线图
.github/workflows/   GitHub Actions，只检查不部署
```

## 文档入口

- [UI/UX 与内容编排](docs/UI-UX.md)：固定布局、章节图谱、节点详情、素材配置与内容人员编辑要求；含尚未实现的目标。
- [AGENTS.md](AGENTS.md)：开发者和 AI Agent 共同遵守的约束。
- [系统架构](docs/ARCHITECTURE.md)：技术选择、目录和运行边界。
- [业务规则](docs/DOMAIN.md)：任务依赖、进度、提交、审核与奖励。
- [账号与权限](docs/AUTH.md)：登录方式、绑定、恢复与供应商前提。
- [开发与验证](docs/DEVELOPMENT.md)：命令、检查、测试和变更流程。
- [部署与数据](docs/DEPLOYMENT.md)：Cloudflare、环境隔离、备份和体积预算。
- [实施路线](docs/ROADMAP.md)：已实现项和未来工作。
- [视频存储与配置](docs/VIDEOS.md)：B2 私有桶、直传、鉴权后缓存、删除、实际容量及告警。
- [课程展示数据](docs/CONTENT.md)：图文、图片引用、背景与装饰协议及当前存储边界。
- [架构决策 0001](docs/adr/0001-single-repo-react-hono.md)：为何采用这套组合。

## API

| 方法和路径                        | 用途                                          |
| --------------------------------- | --------------------------------------------- |
| GET /api/health                   | 服务可达性与 scaffold 标识，不代表数据库健康  |
| GET /api/demo/quest-map           | 只读示例，不含个人进度，mode: demo            |
| GET /api/member/quest-map         | 数据库课程及自己的进度；匿名 progress 为 null |
| POST /api/member/quests/:id/start | 开始已解锁任务，请求体为 {}                   |
| /api/auth/*                       | Better Auth 别称登录与会话接口                |

考核接口（视频与线下共用）：`GET /api/member/quests/:id/learning` 读取自己的历史与奖励，`POST /api/member/quests/:id/assessments` 申请考核。管理员在 `/admin/learning` 选择成员与任务，配置任务奖励、登记考核、查看历史和登记实际交付；对应 `/api/admin/learning/*` 接口均验证管理员权限。完整规则见 [DOMAIN](docs/DOMAIN.md)；视频上传、完成确认、管理员播放与删除接口见 [VIDEOS](docs/VIDEOS.md)。

其他 API 返回 JSON 404。数据库课程使用 mode: placeholder，不复用示例任务 ID。成员课程响应的 map 包含 chapters、全课程 quests 和受控 assets 素材引用；只返回可浏览章节与未归档任务，匿名 progress 为 null。章节可见状态用于浏览过滤；网页编课已实现，保存即生效，不设置独立发布流程。账号测试见 [AUTH](docs/AUTH.md)，环境配置见 [DEPLOYMENT](docs/DEPLOYMENT.md)。

## 协作

首次提交包含锁文件；后续使用 `npm ci` 复现依赖。提交代码前运行检查并阅读 [AGENTS.md](AGENTS.md)。仓库尚未指定开源许可证，公开可见性不等于授权复用。

## 首次管理员

本地迁移后运行 `npm run auth:admin -- bootstrap --local`。专属激活链接只写到被忽略的 `.cache/admin-access/*.txt`，不输出到终端、不自动发消息。站点所有者打开对应文件后，自行填写登录别称和密码激活。工具不设置默认密码，重复 bootstrap 不覆盖现有管理员。

管理员忘记密码或丢失未使用凭证时，拥有本机运维权限的人可显式运行 `npm run auth:admin -- recover --local`，生成新的专属凭证。后台网页不能恢复或创建管理员。
