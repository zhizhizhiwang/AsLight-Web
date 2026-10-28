# Aslight

以任务图谱组织主线与支线的 Wota 艺学习网站。面向个人／社团，从基础练习、成果提交到管理员审核和奖励登记。

## 当前状态

项目初始化阶段：React + Vite + Hono 同仓库、同域名、同一次构建部署。已提供只读示例任务 API、路线图／列表切换、任务详情、图谱规则基础测试与 GitHub Actions 检查。

**尚未实现账号、真实学习进度、数据库、视频上传、审核和奖励发放。** 示例内容不代表正式课程或个人学习记录。未创建 Cloudflare 资源、未部署线上网站。

教程与考核文案由用户提供；当前关卡使用“主线1、主线2、主线3、支线1”等占位名称，开发工作只负责系统功能与内容承载。

## 本地启动

使用 Node.js 24 和 npm。首次克隆后：

```sh
npm ci
npm run dev
```

打开终端输出的本地地址，默认 `http://127.0.0.1:5173`。Vite 与本地 Worker 一起运行，无需登录 Cloudflare，也不需要密钥。Windows PowerShell 若限制 npm.ps1，可使用 `npm.cmd`。

```sh
npm run check        # 格式、类型、边界、测试、构建、体积
npm run format       # 统一格式
npm run build        # 生产构建
npm run preview      # 预览已构建产物，默认端口 4173
```

`npm run deploy` 会先执行全部检查再尝试部署，只有明确要发布且已配置正确的 Cloudflare 账号／资源时使用。当前初始化不执行此命令。

## 目录

```text
src/client/          React 界面、浏览器端 API 客户端
src/server/          Hono 路由、示例数据、服务端业务规则
src/shared/          无环境依赖的数据类型
tests/               Node 原生测试：领域规则和 API 合约
scripts/             代码边界和构建产物体积检查
migrations/          数据库接入时添加可版本化迁移
docs/                产品规则、架构、账号、开发、部署、路线图
.github/workflows/   GitHub Actions，只检查不部署
```

## 文档入口

- [AGENTS.md](AGENTS.md)：开发者和 AI Agent 共同遵守的约束。
- [系统架构](docs/ARCHITECTURE.md)：技术选择、目录和运行边界。
- [业务规则](docs/DOMAIN.md)：任务依赖、进度、提交、审核与奖励。
- [账号与权限](docs/AUTH.md)：登录方式、绑定、恢复与供应商前提。
- [开发与验证](docs/DEVELOPMENT.md)：命令、检查、测试和变更流程。
- [部署与数据](docs/DEPLOYMENT.md)：Cloudflare、环境隔离、备份和体积预算。
- [实施路线](docs/ROADMAP.md)：已实现项和未来工作。
- [架构决策 0001](docs/adr/0001-single-repo-react-hono.md)：为何采用这套组合。

## API 骨架

| 方法和路径                | 用途                                               |
| ------------------------- | -------------------------------------------------- |
| `GET /api/health`         | 返回服务可达状态及 scaffold 标识，不代表数据库健康 |
| `GET /api/demo/quest-map` | 只读示例课程，明确返回 `mode: demo`                |

其他 API 返回 JSON 404，不回退到首页。浏览器页面路径由静态资源的 SPA 回退处理。没有任何写操作或真实成员数据接口。

## 协作

首次提交包含锁文件；后续使用 `npm ci` 复现依赖。提交代码前运行检查并阅读 [AGENTS.md](AGENTS.md)。仓库尚未指定开源许可证，公开可见性不等于授权复用。
