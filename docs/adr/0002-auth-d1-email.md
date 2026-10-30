# ADR 0002：账号、D1 与邮件通道

日期：2026-10-28。状态：已由 ADR 0003 替代；本文仅保留原决策历史，不代表当前配置。

采用 Better Auth 1.7.14 minimal、独立 Drizzle adapter、Drizzle 0.45.4、D1。保持同域 Cookie 与内部 user_id，不把邮箱作为进度身份。默认邀请绑定邮箱，注册不能设置角色。

D1 不支持交互式事务，因此 adapter 明确 transaction=false；进度幂等与限流分别使用单语句唯一键写入和 UPSERT RETURNING。数据库迁移由 Drizzle Kit 生成版本化 SQL，自定义课程数据迁移也登记 journal/snapshot。CI 只在临时本地 D1 执行，禁止自动远程迁移。

用户不使用 Cloudflare 付费 Email Sending，选择 Resend 免费服务。Worker 用 HTTP API 发验证／找回邮件，不引入额外 SDK。默认 local 通道仅允许回环地址，将邮件保存私有本地 D1；上线需验证发信域名与真实邮箱投递，配置独立 secret。

当前没有降低密码 scrypt 参数，云上 CPU 和认证非事务多步骤失败恢复仍需验收。没有开放账号删除、管理员赋权、审核或奖励 API。
