import type { QuestProgress } from '../shared/progress.ts';

export function progressLabel(state: QuestProgress | undefined) {
  if (!state) return '登录后保存';
  const labels = {
    not_started: '未开始',
    in_progress: '学习中',
    submitted: '待审核',
    needs_revision: '需修改',
    passed: '已通过',
  };
  return state.learningStatus === 'not_started' && !state.unlocked
    ? '待解锁'
    : labels[state.learningStatus];
}

export function rewardLabel(state: QuestProgress | undefined) {
  return state?.rewardStatus === 'pending'
    ? '● 奖励待领取'
    : state?.rewardStatus === 'delivered'
      ? '✓ 奖励已领取'
      : '';
}
