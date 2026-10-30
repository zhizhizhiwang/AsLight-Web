# 系统架构

状态：账号、持久化及线下考核／奖励闭环已接入，尚未上线。日期：2026-10-29。未来设计与已实现功能以 ROADMAP 区分。

## 目标与选择

面向中国大陆几十至几百人的学习社团，由一名开发者配合 AI 维护。采用一个仓库、一套 npm 脚本、一次构建部署。前后端分目录，运行时权限明确分离。

| 层         | 选择                              | 当前状态                         |
| ---------- | --------------------------------- | -------------------------------- |
| 界面       | React + TypeScript + Tailwind CSS | 已接入                           |
| 任务地图   | React Flow，按需加载              | 示例已接入                       |
| 开发与构建 | Vite + Cloudflare Vite 插件       | 已接入                           |
| API        | Hono，同域 `/api/*`               | 课程、账号、进度、线下考核与奖励 |
| 账号       | Better Auth                       | 1.7.14，本地 Worker 已验证       |
| 数据库     | D1 + Drizzle                      | 开发 D1 已绑定，本地迁移已验证   |
| 文件       | 私有 R2                           | 预选，无真实绑定                 |
| 版本与检查 | GitHub + Actions                  | 已定义 CI 配置                   |

## 请求路径

浏览器下载静态 React 资源；请求 `/api/*` 时 Worker 执行 Hono。API 路径始终先经过 Worker，因此未知 API 不得被 SPA 回退伪装成成功页面。页面路径由 Cloudflare Static Assets 处理。

地图、列表和任务详情读取同一份课程数据。账号使用同源 HttpOnly Cookie、D1 服务端会话，禁用 Cookie 会话缓存以使撤销立即生效。只有后端能读取数据库、确认解锁、审核通过及发奖。已授权的视频直传对象存储，业务接口仅处理授权和记录。

## 应用布局与页面路由

UI/UX 与数据驱动编排以 [UI-UX](UI-UX.md) 为约束：章节浏览、图文／装饰展示及受独立权限保护的网页编辑已接入。成员接口返回 `CourseMap { mode, revision, chapters, quests, assets }`，按 sort_order 和稳定 ID 排列可浏览章节。只加载 published 章节的未归档任务；该历史字段表示可见性，不是发布步骤。章节、任务、素材与版本通过同一 D1 batch 读取，避免混合两个保存版本。所有章节共用服务端进度和解锁计算，没有可浏览章节时返回空数组。

`/api/content/*` 使用独立 content_permission，管理员不默认拥有编辑能力；`/api/admin/members/:id/content-permission` 管理授权并审计。课程保存即生效，无草稿／发布流程。保存使用版本比较、写入点权限检查和 D1 原子 batch，更新章节与任务并追加 course_change 内容快照。省略已有 ID、非法素材、启用图谱循环或前置指向归档内容均拒绝。编辑不能更改奖励设置或个人业务表。已有学习记录的任务拒绝直接修改前置／考核要求；该限制也在事务写入条件中检查。开始学习、申请及审核同时验证所读取的课程版本，防止依据过期图谱写入。0007 仅新增独立权限、课程版本和修改记录表，不重建业务父表。

采用固定左侧竖直导航和中央内容区，参考用户提供的任务面板草图。`/flow`（流程图）、`/tasks`（任务列表）、`/overview`（主页面）为并列子页；根路径默认跳转流程图。移除宣传首页，主页面只是章节与任务结构概览，不承担进入其他页面的必经入口。

React Router 使用声明式 BrowserRouter 处理客户端路由，无 SSR。当前章节通过 chapter 查询参数表达，兼容只含 quest 的旧链接；类型筛选通过 kind 查询参数表达；任务详情通过 quest 参数打开原生 dialog，保留键盘关闭和焦点恢复。筛选状态在图谱与列表间沿用，任务数据仍来自同一个 API。图谱筛选后保留本章必要前置节点作为淡化上下文；外章前置只在详情显示来源章节及跳转入口，不生成外章副本。章节切换不更改任务 ID 或个人进度。

未知页面在应用中央显示不存在提示；未知 API 仍由 Worker 返回 JSON 404。部署时必须验证三个子页的直接访问与刷新，不仅测试从根路径点击导航。

## 课程展示与素材引用

`shared/content.ts` 校验受控图文块、画布展示参数及图片元数据。chapter.presentation 保存图片图标、背景、初始视野及独立装饰；任务 definition 可含 imageAssetId、content 与 assessmentContent。`course_asset` 只登记素材元数据，服务端仅返回被可浏览课程引用且状态为 published、路径合法的条目。路径限制在公开课程图片命名空间 `/course-assets/`，不接受外部地址或成员作业路径。缺失和未发布引用由客户端回退显示；未知内容块和非法展示参数拒绝加载。

`CourseContent.tsx` 在图谱、列表、概览及详情共用图片解析、缺图回退和图文块渲染，文本由 React 转义。背景为固定画布底图，装饰通过 React Flow ViewportPortal 使用世界坐标，始终位于连线和任务之下且不接收指针事件。装饰范围不计入任务视野或学习统计。移动端优先保持任务触控尺寸，长详情可全屏滚动。

0006 只新增 chapter.presentation 与 course_asset，不重建已有父表，不修改个人业务历史。目前仅支持预先公开的静态课程图片，网页编辑只能选择这些素材，不提供上传或私有文件管理；元数据状态不会保护已放入公开静态目录的文件。完整字段与边界见 [CONTENT](CONTENT.md)。

## 客户端共用控件

`client/ui.tsx` 提供按钮、链接按钮、侧栏导航、输入／选择／多行文本、字段与面板。`client/ui.css` 集中维护视觉变量和交互状态，页面仅负责排布；后台与成员端共用。按钮默认 type=button，表单提交显式指定 type=submit，避免抽取组件后误触提交。无需额外组件库。

## 代码边界

- `client` 可以运行时依赖 `shared`，通过 type-only import 引用 Hono AppType。运行时禁止导入 server 和 Node 模块。
- `server` 可以依赖 `shared`，不能依赖 client。路由负责输入、身份和响应；领域模块负责业务规则；数据库访问在接入时放入 server 下独立模块。
- `shared` 不导入任何平台 API、环境变量、client 或 server。不要因“共享”而把私有业务数据打入前端。
- 密钥和数据库 binding 只在服务端请求上下文内取得。不要在浏览器环境或构建阶段连接正式数据库。
- 当前 HTTP 合约由 Hono RPC 类型推导；任何未来写接口都必须增加运行时验证。

## 保持轻量

第一版不做 SSR、实时协作、微服务或通用工作流引擎。页面导航统一使用 React Router 声明式路由，不引入第二套导航机制。当前请求使用 typed client + React；出现复杂缓存失效需求后再评估 TanStack Query。

示例数据放在 server/data。占位课程已入数据库，使用独立稳定 ID。示例接口保持只读，不产生个人进度。共享类型不是最终数据库 schema。

## 变更规则

替换框架、引入 SSR、数据库迁移方案或新增外部账号供应商时，记录 ADR，说明背景、取舍、迁移影响和验证结果。小功能沿既定模式实现，无需为普通实现重复做架构审批。

## 参考

- [Vite](https://vite.dev/guide/)
- [Cloudflare Vite 插件](https://developers.cloudflare.com/workers/vite-plugin/)
- [Hono + Workers + Vite](https://hono.dev/docs/getting-started/cloudflare-workers-vite)
- [React Flow](https://reactflow.dev/learn)

## 账号与持久化

Better Auth 1.7.14 minimal + 自定义别称插件、Drizzle 0.45.4/D1。email 可为 NULL，插件不向客户端返回邮箱；禁用标准邮箱密码注册入口。自定义登录仅接受 11 位别称和密码，复用库的密码计算、会话和 Cookie。成员由管理员创建待激活记录，通过随机专属凭证激活，无短信／邮件供应商。

服务端用不可变 user_id 关联进度。进度主键 (user_id, quest_id)，重复开始不覆盖审核和奖励状态；前置解锁不依赖奖励。会话、角色、激活状态和凭据版本均由 D1 校验。

账号凭证表按摘要索引，保留用途、有效期、消费／撤销时间、签发人；随机 redemption_id 让原子 D1 batch 中的后续写入只属于成功消费的那次请求。唯一别称冲突整体回滚。新凭证撤销旧凭证，重设及换别称撤销会话并递增凭据版本。审计单独保存，网页不能覆盖历史。

D1 不支持交互式事务，adapter transaction=false；采用单语句和 D1 batch。认证／激活限流使用原子 UPSERT，并清理两天前记录。来源校验、HttpOnly Cookie、no-store、no-referrer 和查询字符串脱敏维持不变。

迁移 0002 显式保存 account/progress，先移除引用表再重建可空邮箱用户表，然后恢复子表，避免 DROP 父表导致级联删除。旧 user_id、密码记录和进度保留，旧会话撤销，旧成员回到待激活并由管理员发放凭证。0003 增加凭据版本。

## 线下考核与奖励

`server/course.ts` 统一装载课程和服务端个人进度，`server/learning.ts` 处理线下尝试、审核与奖励写入。成员接口固定使用会话 user_id；管理接口挂在 `/api/admin/learning`，复用管理员角色、Origin 和限流中间件。共享 Zod 合约校验外部请求及新页面响应。

迁移 0004 新增 assessment_attempt、assessment_review、reward_grant，给 progress 增加版本和操作标记，给 quest 增加奖励说明与版本。审核以进度版本和待审尝试 ID 做条件更新；单次 batch 中只有获胜操作能写入历史、奖励和审计。唯一索引禁止并发待审、重复审核和重复奖励。请求摘要用于识别相同操作重试与不同内容冲突，领域历史没有覆盖或删除接口。

成员在任务详情申请线下考核、查看反馈和领取状态；管理员通过 `/admin/learning` 登记考核、设置任务奖励及登记交付。任务奖励在通过时生成快照。图谱／列表显示待领取及已领取文字和标记，奖励不参与前置解锁。R2 未启用，视频上传和在线审核暂缓。
