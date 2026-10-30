# B2 视频存储

2026-10-31：代码使用 Backblaze B2 私有桶，浏览器直传、Worker 鉴权播放、D1 保存归属与审核历史。原仓库没有已启用的 R2 视频后端，因此没有自动搬迁旧文件。2026-10-31 已配置正式 B2 并部署 aslighters.org；存储级签名上传、私有读取、Range 与永久删除已通过真实接口检查，首个管理员已激活，用户已反馈跑通一次线上流程；视频分支与手机设备覆盖仍需补充记录。

## 开通与配置

1. 创建专用 **Private** 桶，不开启公开访问，不启用会阻止删除的 Object Lock。测试与正式环境使用不同桶。
2. 创建仅限该桶及 `videos/` 前缀的 Application Key，具有 `readFiles`、`writeFiles`、`listFiles`、`deleteFiles` 能力；不要使用 master key。保存 Key ID、Application Key、Bucket ID、Bucket Name 和 S3 Endpoint。
3. 本地将 `.dev.vars.example` 中五个 `B2_*` 字段填入被忽略的 `.dev.vars`。线上使用平台 secret，APP_ORIGIN 必须对应实际 HTTPS 站点。不要把密钥填进网页或 `VITE_` 变量。缺少配置时不开上传，原线下申请仍可用。
4. 配置桶 CORS，精确允许站点来源、PUT 方法及上传请求头。示例 S3 CORS 配置如下，替换站点来源；不要直接使用通配来源。浏览器自动设置 Content-Length，不在客户端手动设置。

```json
{
  "CORSRules": [
    {
      "AllowedOrigins": ["https://your-site.example"],
      "AllowedMethods": ["PUT"],
      "AllowedHeaders": ["content-type", "x-amz-meta-video-id"],
      "MaxAgeSeconds": 300
    }
  ]
}
```

5. 部署前在目标 D1 执行 0009 及此前迁移；仅新增 video，不重建 user、progress 或考核父表。应用包含每 30 分钟 Cron；部署后检查 Cron 已启用。迁移、secret 和部署都需要显式指向目标环境，本次不自动执行云端操作。

## 上传与考核

- 成员先开始已解锁任务，选择视频；首选 MP4，另接受 WebM、QuickTime。上限 100 MiB，浏览器检查一分钟以内。服务端核验对象存在、预留大小、MIME、专属元数据和容器文件头；没有转码或可信服务端时长／编解码器检测，管理员需复核时长与实际可播放性。
- `POST /api/videos` 只接受 questId、size、mimeType，生成归属于会话成员的新 key。五分钟 PUT 签名绑定 key、大小、类型与视频 ID，不向浏览器发放桶级上传 token。
- 上传后 `POST /api/videos/:id/complete` 不接受 key 或版本参数，服务端确认后固定 B2 版本。再次使用上传链接不会改变已确认和考核使用的版本。
- 申请接口可附 videoId；原子检查本人、任务、ready、尚未绑定，然后创建考核尝试、绑定视频并更新进度。失败不消费视频，重复请求不新增尝试。退回后重新上传并创建新尝试，旧审核不可覆盖。
- 原有通过／需修改与反馈就是当前考核结果，不新增数值评分、独立评审角色或匿名上传。奖励与视频文件生命周期独立。线下申请仍可使用。

## 播放与删除

管理员在考核页面读取视频；`GET /api/admin/videos/:id/stream` 每次验证会话与管理员角色，仅播放已提交且 ready 的固定版本。Worker 直接转发流，支持单段 Range、206、Content-Range 与 416，返回 `private, no-store`。不缓存私有视频，不向浏览器返回下载签名或 B2 token。

管理员填写原因发起删除，D1 原子记录操作者、时间和审计并切为 deleting，立即禁止新的播放。评分不自动删除。已经开始的流和管理员已下载的副本无法追回。

Cron 每次处理一个对象，以限制请求数量；等待上传链接过期并留出十五分钟缓冲后，调用 B2 Native API 列出并逐个永久删除明确的 fileId，包括历史版本与隐藏标记，再确认清空才标为 deleted。异常进入 delete_failed，下次重试；多版本分批清理，不把隐藏标记当作删除成功。已删除记录保留七天回扫窗口，检查延迟完成的上传；删除记录和审核历史永久保留。

未绑定考核的上传（包括上传后未提交）超过 24 小时自动进入清理。已绑定的视频不会因时间、考核次数、通过或退回自动清理，只能由管理员发起。建议在 B2 设置旧版本／未完成大文件清理规则作为兜底；不能对当前待审视频设置强制到期规则。

## 配额和运维

D1 为每次授权预留申报字节数；创建授权时原子检查全站预留量不超过 9 GB，每人最多三个未提交上传。后台显示数量、预留占用、7 GB 预警与清理失败数。确认删除前不释放配额。

**这不是 B2 账单或实际桶容量统计。** 重用有效 PUT 链接产生的额外版本、未完成上传、桶外部写入不包含在 D1 预留量中。必须同时在 B2 控制台监控实际用量和费用／上传上限，不把预留量视为不会收费的保证。本仓库不硬编码供应商免费额度或价格。

真实联调须验证：精确 CORS、签名及 Content-Length、真实手机文件上传、对象版本固定、MP4/WebM/QuickTime 播放兼容、拖动进度条、权限撤销、全版本永久删除、Cron 重试与实际容量。本地回归测试使用真实 Worker/D1 和模拟 B2 响应；另已完成真实 B2 存储接口检查及正式域名上传 CORS 检查，用户已反馈跑通一次线上流程；真实手机型号、退回重交及删除等分支的具体覆盖仍需补充记录。

参考：[B2 S3 API](https://www.backblaze.com/docs/en/cloud-storage-call-the-s3-compatible-api)、[B2 CORS](https://www.backblaze.com/docs/cloud-storage-cross-origin-resource-sharing-rules)、[私有 B2 经 Workers 提供](https://www.backblaze.com/docs/cloud-storage-deliver-private-backblaze-b2-content-through-cloudflare-cdn)、[版本列表](https://www.backblaze.com/apidocs/b2-list-file-versions)、[永久删除版本](https://www.backblaze.com/apidocs/b2-delete-file-version)、[Workers 流式响应](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/)。
