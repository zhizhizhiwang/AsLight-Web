import { z } from 'zod';

export const courseImageUrlSchema = z
  .string()
  .max(2048)
  .refine((value) => {
    if (/^\/course-assets\/[a-z0-9][a-z0-9/_-]*\.(png|jpe?g|webp|avif|svg)$/i.test(value))
      return !value.includes('//');
    try {
      const url = new URL(value);
      return (
        url.protocol === 'https:' &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash &&
        !/[\s\\]/.test(value) &&
        !url.hostname.endsWith('.backblazeb2.com')
      );
    } catch {
      return false;
    }
  }, '请填写 HTTPS 图片链接或 /course-assets/ 下的图片路径。');
export const imageReferenceSchema = z.union([
  courseImageUrlSchema,
  z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/),
]);
const assetId = imageReferenceSchema;
// Only reviewed public course images may live here. Never point at member uploads.
export const courseAssetSchema = z.strictObject({
  id: z.string().min(1).max(100),
  path: z.string().regex(/^\/course-assets\/[a-z0-9][a-z0-9/_-]*\.(png|jpe?g|webp|avif|svg)$/i),
  alt: z.string().trim().min(1).max(300),
  width: z.number().int().positive().max(8192),
  height: z.number().int().positive().max(8192),
});
export type CourseAsset = z.infer<typeof courseAssetSchema>;

const text = z.string().trim().min(1).max(10000);
export const contentBlockSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('heading'), text: text.max(200) }),
  z.strictObject({ type: z.literal('paragraph'), text }),
  z.strictObject({
    type: z.literal('list'),
    ordered: z.boolean(),
    items: z.array(text).min(1).max(100),
  }),
  z.strictObject({
    type: z.literal('image'),
    assetId,
    alt: text.max(300),
    caption: text.max(500).optional(),
  }),
]);
export const contentBlocksSchema = z.array(contentBlockSchema).max(100);
export type ContentBlock = z.infer<typeof contentBlockSchema>;

const position = z.strictObject({
  x: z.number().min(-100000).max(100000),
  y: z.number().min(-100000).max(100000),
});
const decorationBase = {
  id: z.string().min(1).max(100),
  position,
  width: z.number().positive().max(8192),
  height: z.number().positive().max(8192),
  layer: z.number().int().min(0).max(20),
};
export const chapterPresentationSchema = z.strictObject({
  iconAssetId: assetId.optional(),
  backgroundAssetId: assetId.optional(),
  viewport: z
    .strictObject({ x: position.shape.x, y: position.shape.y, zoom: z.number().min(0.35).max(2) })
    .optional(),
  decorations: z
    .array(
      z.discriminatedUnion('type', [
        z.strictObject({
          ...decorationBase,
          type: z.literal('image'),
          assetId,
          alt: text.max(300),
        }),
        z.strictObject({ ...decorationBase, type: z.literal('text'), text: text.max(1000) }),
      ]),
    )
    .max(100)
    .refine(
      (items) => new Set(items.map((item) => item.id)).size === items.length,
      '装饰 ID 不可重复。',
    )
    .optional(),
});
export type ChapterPresentation = z.infer<typeof chapterPresentationSchema>;

export function contentAssetIds(blocks: ContentBlock[] = []): string[] {
  return blocks.flatMap((block) => (block.type === 'image' ? [block.assetId] : []));
}
