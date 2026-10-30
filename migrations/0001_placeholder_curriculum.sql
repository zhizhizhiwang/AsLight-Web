-- Placeholder curriculum only. Personal progress is never seeded.
INSERT INTO chapter (id,title,description) VALUES ('chapter-001','第一章','任务内容待添加。');
INSERT INTO quest (id,chapter_id,definition) VALUES ('main-001','chapter-001','{"id":"main-001","chapterId":"chapter-001","title":"主线1","kind":"main","summary":"任务内容待添加。","prerequisites":[],"prerequisiteMode":"all","position":{"x":0,"y":40}}');
INSERT INTO quest (id,chapter_id,definition) VALUES ('main-002','chapter-001','{"id":"main-002","chapterId":"chapter-001","title":"主线2","kind":"main","summary":"任务内容待添加。","prerequisites":["main-001"],"prerequisiteMode":"all","position":{"x":270,"y":40}}');
INSERT INTO quest (id,chapter_id,definition) VALUES ('main-003','chapter-001','{"id":"main-003","chapterId":"chapter-001","title":"主线3","kind":"main","summary":"任务内容待添加。","prerequisites":["main-002"],"prerequisiteMode":"all","position":{"x":540,"y":40}}');
INSERT INTO quest (id,chapter_id,definition) VALUES ('side-001','chapter-001','{"id":"side-001","chapterId":"chapter-001","title":"支线1","kind":"side","summary":"任务内容待添加。","prerequisites":["main-002"],"prerequisiteMode":"all","position":{"x":540,"y":230}}');
