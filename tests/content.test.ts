import assert from 'node:assert/strict';
import test from 'node:test';
import {
  chapterPresentationSchema,
  contentAssetIds,
  contentBlocksSchema,
  courseAssetSchema,
  courseImageUrlSchema,
} from '../src/shared/content.ts';

const asset = {
  id: 'image',
  path: '/course-assets/unit/image.webp',
  alt: '素材说明',
  width: 640,
  height: 360,
};
test('course images accept only controlled public paths and bounded metadata', () => {
  assert.equal(courseAssetSchema.parse(asset).path, asset.path);
  for (const path of [
    'https://example.test/image.png',
    '//example.test/image.png',
    '/uploads/member.png',
    '/course-assets/../secret.png',
    '/course-assets/%2e%2e/secret.png',
    '/course-assets/image.png?token=secret',
    'data:image/png;base64,a',
  ]) {
    assert.equal(courseAssetSchema.safeParse({ ...asset, path }).success, false, path);
  }
  for (const change of [{ width: 0 }, { height: Infinity }, { width: 9000 }, { alt: '' }]) {
    assert.equal(courseAssetSchema.safeParse({ ...asset, ...change }).success, false);
  }
});

test('structured content retains authored order and text, with image references only', () => {
  const blocks = contentBlocksSchema.parse([
    { type: 'heading', text: '任务内容待添加' },
    { type: 'paragraph', text: '<img src=x onerror=alert(1)>' },
    { type: 'list', ordered: true, items: ['任务内容待添加'] },
    { type: 'image', assetId: 'image', alt: '图片说明', caption: '图片说明待添加' },
  ]);
  assert.deepEqual(
    blocks.map((block) => block.type),
    ['heading', 'paragraph', 'list', 'image'],
  );
  assert.deepEqual(contentAssetIds(blocks), ['image']);
  for (const block of [
    { type: 'html', html: '<script>alert(1)</script>' },
    { type: 'image', assetId: 'x', alt: '' },
    { type: 'paragraph', text: '文本', style: { position: 'fixed' } },
    { type: 'list', ordered: false, items: [] },
  ]) {
    assert.equal(contentBlocksSchema.safeParse([block]).success, false);
  }
});

test('canvas configuration bounds geometry and layers without executable content', () => {
  const decoration = {
    id: 'note',
    type: 'text',
    text: '任务内容待添加',
    position: { x: 0, y: 0 },
    width: 200,
    height: 80,
    layer: 0,
  };
  assert.ok(
    chapterPresentationSchema.safeParse({
      viewport: { x: 0, y: 40, zoom: 1 },
      decorations: [decoration],
    }).success,
  );
  for (const value of [
    { decorations: [decoration, decoration] },
    { decorations: [{ ...decoration, layer: 999 }] },
    { decorations: [{ ...decoration, width: -1 }] },
    { viewport: { x: 0, y: 0, zoom: 0.01 } },
    { css: 'body { display: none }' },
  ]) {
    assert.equal(chapterPresentationSchema.safeParse(value).success, false);
  }
});

test('authored image links allow HTTPS and deployed paths without executable or private upload links', () => {
  for (const url of ['/course-assets/chapter/image.webp', 'https://images.example.test/image.png'])
    assert.ok(courseImageUrlSchema.safeParse(url).success, url);
  for (const url of [
    '//evil.test/x',
    'javascript:alert(1)',
    'data:image/svg+xml,x',
    'http://example.test/x',
    '/api/admin/videos/x/stream',
    '/uploads/x.mp4',
    '/course-assets/a/../x.png',
    '/course-assets/a//x.png',
    'https://user:password@example.test/x',
    'https://example.test/x?token=secret',
    'https://s3.us-west-004.backblazeb2.com/private/x',
  ])
    assert.equal(courseImageUrlSchema.safeParse(url).success, false, url);
});
