import type { AssessmentRecord, RewardRecord } from '../shared/assessments.ts';

export const displayTime = (value: number) => new Date(value).toLocaleString('zh-CN');

export function AssessmentHistory({ records }: { records: AssessmentRecord[] }) {
  return (
    <section className="assessment-history" aria-label="考核记录">
      <h3>考核记录</h3>
      {!records.length ? (
        <p>暂无考核记录。</p>
      ) : (
        <ol>
          {records.map((record) => (
            <li key={record.id}>
              <strong>
                第 {record.number} 次 ·{' '}
                {record.review
                  ? record.review.decision === 'passed'
                    ? '已通过'
                    : '需修改'
                  : '等待考核'}
              </strong>
              <p>
                {displayTime(record.requestedAt)} · 申请／登记：{record.requestedByName}
              </p>
              {record.memberNote && <p className="preserve-text">申请备注：{record.memberNote}</p>}
              {record.review && (
                <>
                  <p>
                    考核：{displayTime(record.review.assessedAt)} · {record.review.reviewerName}
                  </p>
                  <p>登记：{displayTime(record.review.reviewedAt)}</p>
                  {record.review.feedback && (
                    <p className="preserve-text">反馈：{record.review.feedback}</p>
                  )}
                  {record.review.rewardLabel && <p>本次奖励：{record.review.rewardLabel}</p>}
                </>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function RewardSummary({ reward }: { reward: RewardRecord | null }) {
  if (!reward) return null;
  return (
    <section className="reward-summary" aria-label="个人奖励">
      <h3>{reward.status === 'pending' ? '● 奖励待领取' : '✓ 奖励已领取'}</h3>
      <p>{reward.label}</p>
      {reward.status === 'pending' ? (
        <p>请联系管理员线下领取，不影响继续学习。</p>
      ) : (
        <>
          <p>
            {reward.deliveredAt === null ? '' : displayTime(reward.deliveredAt)} · 登记：
            {reward.deliveredByName}
          </p>
          {reward.deliveryNote && <p className="preserve-text">领取备注：{reward.deliveryNote}</p>}
        </>
      )}
    </section>
  );
}
