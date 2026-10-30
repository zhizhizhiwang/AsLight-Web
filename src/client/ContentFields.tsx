import { useEffect, useState } from 'react';
import { Button, Field, Input, Select, Textarea } from './ui.tsx';
import type { CourseAsset, ContentBlock, ChapterPresentation } from '../shared/content.ts';

export function NumberField({
  label,
  value,
  onChange,
  min = -100000,
  max = 100000,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <Field>
      {label}
      <Input
        type="number"
        required
        min={min}
        max={max}
        step={step}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (e.target.value && Number.isFinite(e.target.valueAsNumber))
            onChange(e.target.valueAsNumber);
        }}
      />
    </Field>
  );
}
export function AssetField({
  label,
  value,
  assets,
  onChange,
  optional = true,
}: {
  label: string;
  value: string | undefined;
  assets: CourseAsset[];
  onChange: (id: string) => void;
  optional?: boolean;
}) {
  return (
    <Field>
      {label}
      <Input
        value={assets.find((a) => a.id === value)?.path ?? value ?? ''}
        required={!optional}
        maxLength={2048}
        placeholder="/course-assets/chapter/image.webp 或 HTTPS 图片链接"
        onChange={(e) => onChange(e.target.value)}
      />
      <small>填写公开图片链接；留空则不使用图片。</small>
    </Field>
  );
}
export function BlocksEditor({
  value,
  onChange,
  assets,
  label,
  disabled = false,
}: {
  value: ContentBlock[];
  onChange: (blocks: ContentBlock[]) => void;
  assets: CourseAsset[];
  label: string;
  disabled?: boolean;
}) {
  const update = (index: number, block: ContentBlock) =>
    onChange(value.map((b, i) => (i === index ? block : b)));
  const move = (from: number, to: number) => {
    const next = [...value];
    const item = next.splice(from, 1)[0];
    if (item) {
      next.splice(to, 0, item);
      onChange(next);
    }
  };
  return (
    <fieldset className="editor-group" disabled={disabled}>
      <legend>{label}</legend>
      {!value.length && <p className="account-note">尚未添加内容。文字由内容人员填写。</p>}
      {value.map((block, index) => (
        <div className="editor-block" key={index}>
          <div className="control-group">
            <strong>
              {index + 1} ·{' '}
              {{ heading: '标题', paragraph: '段落', list: '列表', image: '图片' }[block.type]}
            </strong>
            <Button
              aria-label={`上移${label}第${index + 1}块`}
              disabled={index === 0}
              onClick={() => move(index, index - 1)}
            >
              上移
            </Button>
            <Button
              aria-label={`下移${label}第${index + 1}块`}
              disabled={index === value.length - 1}
              onClick={() => move(index, index + 1)}
            >
              下移
            </Button>
            <Button onClick={() => onChange(value.filter((_, i) => i !== index))}>移除此块</Button>
          </div>
          {(block.type === 'heading' || block.type === 'paragraph') && (
            <Field>
              文字
              <Textarea
                required
                maxLength={block.type === 'heading' ? 200 : 10000}
                rows={block.type === 'heading' ? 2 : 4}
                value={block.text}
                onChange={(e) => update(index, { ...block, text: e.target.value })}
              />
            </Field>
          )}
          {block.type === 'list' && (
            <>
              <Field>
                列表形式
                <Select
                  value={block.ordered ? 'ordered' : 'unordered'}
                  onChange={(e) =>
                    update(index, { ...block, ordered: e.target.value === 'ordered' })
                  }
                >
                  <option value="unordered">项目列表</option>
                  <option value="ordered">编号列表</option>
                </Select>
              </Field>
              <Field>
                列表内容（每行一项）
                <Textarea
                  required
                  rows={4}
                  value={block.items.join('\n')}
                  onChange={(e) => update(index, { ...block, items: e.target.value.split('\n') })}
                />
              </Field>
            </>
          )}
          {block.type === 'image' && (
            <>
              <AssetField
                label="图片"
                value={block.assetId}
                assets={assets}
                optional={false}
                onChange={(assetId) =>
                  update(index, {
                    ...block,
                    assetId,
                    alt: assets.find((a) => a.id === assetId)?.alt ?? block.alt,
                  })
                }
              />
              <Field>
                图片文字说明
                <Input
                  required
                  maxLength={300}
                  value={block.alt}
                  onChange={(e) => update(index, { ...block, alt: e.target.value })}
                />
              </Field>
              <Field>
                图注（选填）
                <Input
                  maxLength={500}
                  value={block.caption ?? ''}
                  onChange={(e) => {
                    const { caption: _caption, ...rest } = block;
                    update(index, e.target.value ? { ...rest, caption: e.target.value } : rest);
                  }}
                />
              </Field>
            </>
          )}
        </div>
      ))}
      <div className="control-group">
        <Button
          disabled={value.length >= 100}
          onClick={() => onChange([...value, { type: 'heading', text: '' }])}
        >
          添加标题
        </Button>
        <Button
          disabled={value.length >= 100}
          onClick={() => onChange([...value, { type: 'paragraph', text: '' }])}
        >
          添加段落
        </Button>
        <Button
          disabled={value.length >= 100}
          onClick={() => onChange([...value, { type: 'list', ordered: false, items: [''] }])}
        >
          添加列表
        </Button>
        <Button
          disabled={value.length >= 100}
          onClick={() => {
            const asset = assets[0];
            onChange([
              ...value,
              { type: 'image', assetId: asset?.path ?? '', alt: asset?.alt ?? '' },
            ]);
          }}
        >
          添加图片
        </Button>
      </div>
    </fieldset>
  );
}

type Decoration = NonNullable<ChapterPresentation['decorations']>[number];
export function DecorationsEditor({
  value,
  onChange,
  assets,
}: {
  value: Decoration[];
  onChange: (value: Decoration[]) => void;
  assets: CourseAsset[];
}) {
  const update = (index: number, item: Decoration) =>
    onChange(value.map((v, i) => (i === index ? item : v)));
  const add = (type: 'text' | 'image') => {
    const base = {
      id: crypto.randomUUID(),
      position: { x: 0, y: 0 },
      width: 240,
      height: 100,
      layer: 0,
    };
    const asset = assets[0];
    if (type === 'text') onChange([...value, { ...base, type, text: '' }]);
    else onChange([...value, { ...base, type, assetId: asset?.path ?? '', alt: asset?.alt ?? '' }]);
  };
  return (
    <fieldset className="editor-group">
      <legend>画布装饰</legend>
      <p className="account-note">装饰显示在任务下方，不影响学习进度。</p>
      {value.map((item, index) => (
        <div className="editor-block" key={item.id}>
          <strong>装饰 {index + 1}</strong>
          {item.type === 'text' ? (
            <Field>
              装饰文字
              <Textarea
                required
                maxLength={1000}
                value={item.text}
                onChange={(e) => update(index, { ...item, text: e.target.value })}
              />
            </Field>
          ) : (
            <>
              <AssetField
                label="装饰图片"
                value={item.assetId}
                assets={assets}
                optional={false}
                onChange={(assetId) => update(index, { ...item, assetId })}
              />
              <Field>
                图片说明
                <Input
                  required
                  maxLength={300}
                  value={item.alt}
                  onChange={(e) => update(index, { ...item, alt: e.target.value })}
                />
              </Field>
            </>
          )}
          <div className="editor-fields">
            {(['x', 'y'] as const).map((axis) => (
              <NumberField
                key={axis}
                label={axis === 'x' ? '横向位置' : '纵向位置'}
                value={item.position[axis]}
                onChange={(n) =>
                  update(index, { ...item, position: { ...item.position, [axis]: n } })
                }
              />
            ))}
            <NumberField
              label="宽度"
              value={item.width}
              min={1}
              max={8192}
              onChange={(width) => update(index, { ...item, width })}
            />
            <NumberField
              label="高度"
              value={item.height}
              min={1}
              max={8192}
              onChange={(height) => update(index, { ...item, height })}
            />
            <NumberField
              label="图层"
              value={item.layer}
              min={0}
              max={20}
              onChange={(layer) => update(index, { ...item, layer })}
            />
          </div>
          <Button onClick={() => onChange(value.filter((_, i) => i !== index))}>移除装饰</Button>
        </div>
      ))}
      <div className="control-group">
        <Button disabled={value.length >= 100} onClick={() => add('text')}>
          添加文字装饰
        </Button>
        <Button disabled={value.length >= 100} onClick={() => add('image')}>
          添加图片装饰
        </Button>
      </div>
    </fieldset>
  );
}
