import type { QuestMap } from '../../shared/quests.ts';
import { validateQuestGraph } from '../domain/quest-graph.ts';

export const demoQuestMap: QuestMap = {
  mode: 'demo',
  chapter: {
    id: 'demo-introduction',
    title: '第一章',
    description: '主线与支线结构示例。',
  },
  quests: [
    {
      id: 'demo-start',
      chapterId: 'demo-introduction',
      title: '主线1',
      summary: '任务内容待添加。',
      kind: 'main',
      prerequisites: [],
      prerequisiteMode: 'all',
      position: { x: 0, y: 40 },
    },
    {
      id: 'demo-basics',
      chapterId: 'demo-introduction',
      title: '主线2',
      summary: '任务内容待添加。',
      kind: 'main',
      prerequisites: ['demo-start'],
      prerequisiteMode: 'all',
      position: { x: 270, y: 40 },
    },
    {
      id: 'demo-combination',
      chapterId: 'demo-introduction',
      title: '主线3',
      summary: '任务内容待添加。',
      kind: 'main',
      prerequisites: ['demo-basics'],
      prerequisiteMode: 'all',
      position: { x: 540, y: 40 },
    },
    {
      id: 'demo-rhythm',
      chapterId: 'demo-introduction',
      title: '支线1',
      summary: '任务内容待添加。',
      kind: 'side',
      prerequisites: ['demo-basics'],
      prerequisiteMode: 'all',
      position: { x: 540, y: 230 },
    },
  ],
};

validateQuestGraph(demoQuestMap.quests);
