# 系统架构

状态：初始化基线。日期：2026-10-28。未来设计与已实现功能以 ROADMAP 区分。

## 目标与选择

面向中国大陆几十至几百人的学习社团，由一名开发者配合 AI 维护。采用一个仓库、一套 npm 脚本、一次构建部署。前后端分目录，运行时权限明确分离。

| 层         | 选择                              | 当前状态                   |
| ---------- | --------------------------------- | -------------------------- |
| 界面       | React + TypeScript + Tailwind CSS | 已接入                     |
| 任务地图   | React Flow，按需加载              | 示例已接入                 |
| 开发与构建 | Vite + Cloudflare Vite 插件       | 已接入                     |
| API        | Hono，同域 `/api/*`               | 只读骨架                   |
| 账号       | Better Auth                       | 预选，未安装；需兼容性验证 |
| 数据库     | D1 + Drizzle                      | 预选，无真实绑定和迁移     |
| 文件       | 私有 R2                           | 预选，无真实绑定           |
| 版本与检查 | GitHub + Actions                  | 已定义 CI 配置             |

## 请求路径

浏览器下载静态 React 资源；请求 `/api/*` 时 Worker 执行 Hono。API 路径始终先经过 Worker，因此未知 API 不得被 SPA 回退伪装成成功页面。页面路径由 Cloudflare Static Assets 处理。

地图、列表和任务详情读取同一份课程数据。后续账号会话使用同源安全 Cookie。只有后端能读取数据库、确认解锁、审核通过及发奖。已授权的视频直传对象存储，业务接口仅处理授权和记录。

## 代码边界

- `client` 可以运行时依赖 `shared`，通过 type-only import 引用 Hono AppType。运行时禁止导入 server 和 Node 模块。
- `server` 可以依赖 `shared`，不能依赖 client。路由负责输入、身份和响应；领域模块负责业务规则；数据库访问在接入时放入 server 下独立模块。
- `shared` 不导入任何平台 API、环境变量、client 或 server。不要因“共享”而把私有业务数据打入前端。
- 密钥和数据库 binding 只在服务端请求上下文内取得。不要在浏览器环境或构建阶段连接正式数据库。
- 当前 HTTP 合约由 Hono RPC 类型推导；任何未来写接口都必须增加运行时验证。

## 保持轻量

第一版不做 SSR、实时协作、微服务或通用工作流引擎。当前一个页面无需额外页面路由库；出现实际多页导航时统一引入 React Router。当前请求使用 typed client + React；出现复杂缓存失效需求后再评估 TanStack Query。

示例数据放在 server/data。未来正式课程进入数据库后删除或严格隔离示例入口，不自动将演示节点转成用户进度。共享类型不是最终数据库 schema。

## 变更规则

替换框架、引入 SSR、数据库迁移方案或新增外部账号供应商时，记录 ADR，说明背景、取舍、迁移影响和验证结果。小功能沿既定模式实现，无需为普通实现重复做架构审批。

## 参考

- [Vite](https://vite.dev/guide/)
- [Cloudflare Vite 插件](https://developers.cloudflare.com/workers/vite-plugin/)
- [Hono + Workers + Vite](https://hono.dev/docs/getting-started/cloudflare-workers-vite)
- [React Flow](https://reactflow.dev/learn)
